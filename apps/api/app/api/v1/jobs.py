from typing import Annotated, Literal

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.core.errors import NotFound
from app.models import Job, ProjectMember
from app.schemas import JobOut, Page
from app.security.deps import Auth, DbSession, load_project_access
from app.workers import queue

router = APIRouter(prefix="/jobs", tags=["jobs"])


def _visible_jobs(user_id: str):  # type: ignore[no-untyped-def]
    member_projects = select(ProjectMember.project_id).where(ProjectMember.user_id == user_id)
    return select(Job).where((Job.project_id.in_(member_projects)) | ((Job.project_id.is_(None))
                                                                       & (Job.created_by == user_id)))


@router.get("", response_model=Page[JobOut])
def list_jobs(
    auth: Auth,
    db: DbSession,
    project_id: str | None = None,
    status: Literal["pending", "running", "succeeded", "failed", "cancelled", "active"] | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[JobOut]:
    stmt = _visible_jobs(auth.user.id)
    if project_id:
        load_project_access(db, auth.user, project_id)
        stmt = stmt.where(Job.project_id == project_id)
    if status == "active":
        stmt = stmt.where(Job.status.in_(["pending", "running"]))
    elif status:
        stmt = stmt.where(Job.status == status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = db.scalars(stmt.order_by(Job.created_at.desc()).limit(limit).offset(offset)).all()
    return Page(items=[JobOut.model_validate(j) for j in items], total=total, limit=limit, offset=offset)


def _get_job(db, auth, job_id: str, min_role: str = "viewer") -> Job:  # type: ignore[no-untyped-def]
    job = db.get(Job, job_id)
    if job is None:
        raise NotFound("Job not found")
    if job.project_id:
        load_project_access(db, auth.user, job.project_id, min_role)  # type: ignore[arg-type]
    elif job.created_by != auth.user.id:
        raise NotFound("Job not found")
    return job


@router.get("/{job_id}", response_model=JobOut)
def get_job(job_id: str, auth: Auth, db: DbSession) -> Job:
    return _get_job(db, auth, job_id)


@router.post("/{job_id}/cancel", response_model=JobOut)
def cancel_job(job_id: str, auth: Auth, db: DbSession) -> Job:
    job = _get_job(db, auth, job_id, "editor")
    return queue.request_cancel(db, job)
