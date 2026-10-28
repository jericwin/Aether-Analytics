"""Durable, database-backed job queue.

Jobs are rows in the ``jobs`` table, so they survive API and worker restarts. Workers claim jobs
with an atomic conditional UPDATE (status pending -> running), which is safe with multiple
workers on both PostgreSQL and SQLite. Running jobs heartbeat; jobs whose worker died are
returned to the queue (up to MAX_ATTEMPTS) by ``recover_stale``.

Handlers receive a JobContext for progress reporting and cooperative cancellation."""

import logging
import os
import socket
import threading
import traceback
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.logging import log_event
from app.db.session import get_sessionmaker
from app.models import Job

logger = logging.getLogger("aether.worker")
MAX_ATTEMPTS = 3
TERMINAL = {"succeeded", "failed", "cancelled"}


class JobCancelled(Exception):
    pass


class JobContext:
    def __init__(self, job_id: str, payload: dict[str, Any], project_id: str | None, user_id: str | None) -> None:
        self.job_id = job_id
        self.payload = payload
        self.project_id = project_id
        self.user_id = user_id

    def progress(self, fraction: float | None, message: str | None = None) -> None:
        """Record progress + heartbeat; raises JobCancelled if cancellation was requested."""
        with get_sessionmaker()() as db:
            job = db.get(Job, self.job_id)
            if job is None:
                raise JobCancelled()
            if job.cancel_requested:
                raise JobCancelled()
            job.progress = None if fraction is None else max(0.0, min(1.0, fraction))
            if message:
                job.progress_message = message[:255]
            job.heartbeat_at = datetime.now(UTC)
            db.commit()


Handler = Callable[[JobContext], dict[str, Any] | None]
FailureHook = Callable[[JobContext, str], None]
_handlers: dict[str, Handler] = {}
_failure_hooks: dict[str, FailureHook] = {}


def register(job_type: str, on_failure: FailureHook | None = None) -> Callable[[Handler], Handler]:
    def deco(fn: Handler) -> Handler:
        _handlers[job_type] = fn
        if on_failure:
            _failure_hooks[job_type] = on_failure
        return fn

    return deco


def enqueue(db: Session, *, job_type: str, payload: dict[str, Any], project_id: str | None,
            user_id: str | None) -> Job:
    """Persist a job. The caller's transaction is committed so the worker can see it."""
    if job_type not in _handlers:
        raise AppError(f"Unknown job type '{job_type}'", code="unknown_job_type", status_code=500)
    job = Job(job_type=job_type, payload=payload, project_id=project_id, created_by=user_id, status="pending")
    db.add(job)
    db.commit()
    if get_settings().worker_mode == "inline":
        run_job(job.id)
        db.refresh(job)
    return job


def request_cancel(db: Session, job: Job) -> Job:
    if job.status == "pending":
        job.status = "cancelled"
        job.finished_at = datetime.now(UTC)
        job.cancel_requested = True
    elif job.status == "running":
        job.cancel_requested = True
    db.commit()
    return job


def claim_next(worker_id: str) -> str | None:
    with get_sessionmaker()() as db:
        candidates = db.scalars(
            select(Job.id).where(Job.status == "pending").order_by(Job.created_at).limit(5)
        ).all()
        for job_id in candidates:
            now = datetime.now(UTC)
            res = db.execute(
                update(Job)
                .where(Job.id == job_id, Job.status == "pending")
                .values(status="running", worker_id=worker_id, started_at=now, heartbeat_at=now,
                        attempts=Job.attempts + 1)
            )
            db.commit()
            if res.rowcount == 1:  # type: ignore[attr-defined]
                return job_id
    return None


def _finish(job_id: str, **values: Any) -> None:
    with get_sessionmaker()() as db:
        db.execute(update(Job).where(Job.id == job_id).values(finished_at=datetime.now(UTC), **values))
        db.commit()


def run_job(job_id: str, worker_id: str = "inline") -> None:
    """Execute a job by id. In inline mode the job is claimed here."""
    with get_sessionmaker()() as db:
        job = db.get(Job, job_id)
        if job is None:
            return
        if job.status == "pending":
            now = datetime.now(UTC)
            job.status, job.worker_id, job.started_at, job.heartbeat_at = "running", worker_id, now, now
            job.attempts += 1
            db.commit()
        ctx = JobContext(job.id, dict(job.payload), job.project_id, job.created_by)
        handler = _handlers.get(job.job_type)
        job_type = job.job_type

    log_event(logger, "job started", job_id=job_id, job_type=job_type)
    try:
        if handler is None:
            raise AppError(f"No handler registered for '{job_type}'", code="unknown_job_type")
        result = handler(ctx)
    except JobCancelled:
        _finish(job_id, status="cancelled", error_code="cancelled", error_message="Cancelled by user")
        _run_failure_hook(job_type, ctx, "Cancelled by user")
        log_event(logger, "job cancelled", job_id=job_id)
        return
    except AppError as exc:
        _finish(job_id, status="failed", error_code=exc.code, error_message=exc.message)
        _run_failure_hook(job_type, ctx, exc.message)
        log_event(logger, "job failed", logging.WARNING, job_id=job_id, error_code=exc.code)
        return
    except Exception as exc:  # unexpected: keep details in logs, show a safe message to users
        _finish(job_id, status="failed", error_code="internal_error",
                error_message="The job failed due to an internal error. See server logs for details.")
        _run_failure_hook(job_type, ctx, "Internal error")
        log_event(logger, "job crashed", logging.ERROR, job_id=job_id, error=repr(exc),
                  trace=traceback.format_exc(limit=8))
        return
    _finish(job_id, status="succeeded", progress=1.0, result=result or {})
    log_event(logger, "job succeeded", job_id=job_id, job_type=job_type)


def _run_failure_hook(job_type: str, ctx: JobContext, message: str) -> None:
    hook = _failure_hooks.get(job_type)
    if hook:
        try:
            hook(ctx, message)
        except Exception:
            logger.exception("failure hook crashed")


def recover_stale() -> int:
    """Requeue running jobs whose worker stopped heart-beating (e.g. process crash/restart)."""
    cutoff = datetime.now(UTC) - timedelta(seconds=get_settings().job_stale_after_seconds)
    recovered = 0
    with get_sessionmaker()() as db:
        stale = db.scalars(select(Job).where(Job.status == "running", Job.heartbeat_at < cutoff)).all()
        for job in stale:
            if job.attempts >= MAX_ATTEMPTS:
                job.status, job.finished_at = "failed", datetime.now(UTC)
                job.error_code, job.error_message = "worker_lost", "The worker stopped responding repeatedly"
            else:
                job.status, job.worker_id = "pending", None
            recovered += 1
        db.commit()
    return recovered


class Worker:
    def __init__(self) -> None:
        self.worker_id = f"{socket.gethostname()}-{os.getpid()}-{threading.get_ident() % 10000}"
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()

    def run_forever(self) -> None:
        from app.workers import handlers  # noqa: F401  (registers handlers)

        poll = get_settings().worker_poll_seconds
        log_event(logger, "worker started", worker_id=self.worker_id)
        last_recover = 0.0
        while not self._stop.is_set():
            try:
                now = datetime.now(UTC).timestamp()
                if now - last_recover > 30:
                    recover_stale()
                    last_recover = now
                job_id = claim_next(self.worker_id)
                if job_id:
                    run_job(job_id, self.worker_id)
                    continue
            except Exception:
                logger.exception("worker loop error")
            self._stop.wait(poll)
        log_event(logger, "worker stopped", worker_id=self.worker_id)
