"""FastAPI application factory."""

import logging
import threading
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import duckdb
import polars as pl
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import func, select, text

from app.api.v1 import auth, dashboards, datasets, jobs, projects, queries
from app.core.config import REPO_ROOT, get_settings
from app.core.errors import error_body, install_error_handlers
from app.core.logging import configure_logging, log_event, request_id_var
from app.core.storage import storage_root
from app.db.session import get_sessionmaker
from app.models import Job
from app.workers import handlers  # noqa: F401  (registers job handlers)
from app.workers.queue import Worker

logger = logging.getLogger("aether.api")
API_PREFIX = "/api/v1"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    for area in ("uploads", "datasets", "exports"):
        (storage_root() / area).mkdir(parents=True, exist_ok=True)
    worker: Worker | None = None
    if settings.worker_mode == "embedded":
        worker = Worker()
        threading.Thread(target=worker.run_forever, name="aether-worker", daemon=True).start()
    app.state.worker = worker
    log_event(logger, "api started", env=settings.env, worker_mode=settings.worker_mode,
              db="sqlite" if settings.is_sqlite else "postgresql")
    yield
    if worker:
        worker.stop()


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level, settings.log_json)
    app = FastAPI(
        title="Aether Analytics API",
        version="0.1.0",
        description="Local-first business intelligence platform. All routes are versioned under /api/v1.",
        lifespan=lifespan,
        docs_url=f"{API_PREFIX}/docs",
        openapi_url=f"{API_PREFIX}/openapi.json",
        redoc_url=None,
    )
    install_error_handlers(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "X-CSRF-Token", "X-Request-ID"],
        expose_headers=["X-Request-ID", "X-Aether-Truncated", "Content-Disposition"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next: Any) -> Any:
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        if not rid.replace("-", "").isalnum() or len(rid) > 64:
            rid = uuid.uuid4().hex[:16]
        token = request_id_var.set(rid)
        try:
            length = request.headers.get("content-length")
            is_upload = request.url.path.endswith("/uploads")
            limit_mb = settings.max_upload_mb if is_upload else settings.max_request_mb
            if length and length.isdigit() and int(length) > limit_mb * 1024 * 1024:
                return JSONResponse(error_body("payload_too_large", f"Request body exceeds {limit_mb} MB"),
                                    status_code=413, headers={"X-Request-ID": rid})
            start = time.perf_counter()
            response = await call_next(request)
            response.headers["X-Request-ID"] = rid
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["Referrer-Policy"] = "same-origin"
            response.headers["X-Frame-Options"] = "DENY"
            if request.url.path.startswith(API_PREFIX):
                response.headers["Cache-Control"] = "no-store"
                log_event(logger, "request", method=request.method, path=request.url.path,
                          status=response.status_code, ms=round((time.perf_counter() - start) * 1000, 1))
            return response
        finally:
            request_id_var.reset(token)

    for router in (auth.router, projects.router, datasets.router, queries.router, dashboards.router, jobs.router):
        app.include_router(router, prefix=API_PREFIX)

    @app.get(f"{API_PREFIX}/health", tags=["health"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get(f"{API_PREFIX}/health/ready", tags=["health"])
    def ready() -> JSONResponse:
        checks: dict[str, Any] = {}
        ok = True
        try:
            with get_sessionmaker()() as db:
                db.execute(text("SELECT 1"))
                checks["database"] = {"ok": True, "backend": "sqlite" if settings.is_sqlite else "postgresql"}
                rows = db.execute(select(Job.status, func.count()).where(
                    Job.status.in_(["pending", "running"])).group_by(Job.status)).all()
                checks["jobs"] = {status: n for status, n in rows}
        except Exception as exc:
            ok = False
            checks["database"] = {"ok": False, "error": type(exc).__name__}
        try:
            probe = storage_root() / ".write_probe"
            probe.write_text("ok")
            probe.unlink()
            checks["storage"] = {"ok": True}
        except OSError as exc:
            ok = False
            checks["storage"] = {"ok": False, "error": type(exc).__name__}
        checks["engine"] = {"duckdb": duckdb.__version__, "polars": pl.__version__}
        checks["worker_mode"] = settings.worker_mode
        return JSONResponse({"status": "ok" if ok else "degraded", "checks": checks}, status_code=200 if ok else 503)

    _mount_frontend(app)
    return app


def _mount_frontend(app: FastAPI) -> None:
    """Serve the built web app (apps/web/dist) when present, for single-process local use."""
    dist = REPO_ROOT / "apps" / "web" / "dist"
    if not (dist / "index.html").exists():
        return
    root = dist.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            return JSONResponse(error_body("not_found", "Not found"), status_code=404)  # type: ignore[return-value]
        candidate = (root / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(root):
            return FileResponse(candidate)
        return FileResponse(root / "index.html")


app = create_app()


def run() -> None:
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=False)


