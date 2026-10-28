import shutil
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.storage import safe_path
from app.models import (
    AuditLog,
    Dashboard,
    Dataset,
    DatasetVersion,
    Job,
    Project,
    ProjectMember,
    QueryHistory,
    SavedQuery,
    User,
)
from app.services import audit


def list_projects(db: Session, user: User, *, search: str | None, status: str | None, limit: int,
                  offset: int) -> tuple[list[tuple[Project, str]], int]:
    stmt = (
        select(Project, ProjectMember.role)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(ProjectMember.user_id == user.id)
    )
    if status:
        stmt = stmt.where(Project.status == status)
    if search:
        like = f"%{search.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(Project.name).like(like), func.lower(Project.description).like(like)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(stmt.order_by(Project.updated_at.desc()).limit(limit).offset(offset)).all()
    return [(p, r) for p, r in rows], total


def create_project(db: Session, user: User, name: str, description: str | None, is_demo: bool = False) -> Project:
    project = Project(name=name.strip(), description=description, owner_id=user.id, is_demo=is_demo)
    db.add(project)
    db.flush()
    db.add(ProjectMember(project_id=project.id, user_id=user.id, role="owner"))
    audit.record(db, user_id=user.id, project_id=project.id, action="project.created", resource_type="project",
                 resource_id=project.id, summary=f"Created project '{project.name}'")
    db.commit()
    return project


def update_project(db: Session, user: User, project: Project, changes: dict[str, Any]) -> Project:
    if "status" in changes and changes["status"] not in ("active", "archived"):
        raise ValidationFailed("Invalid status")
    for key in ("name", "description", "status"):
        if key in changes and changes[key] is not None:
            setattr(project, key, changes[key].strip() if key == "name" else changes[key])
    project.updated_at = datetime.now(UTC)
    action = {"archived": "project.archived", "active": "project.restored"}.get(changes.get("status") or "",
                                                                                  "project.updated")
    audit.record(db, user_id=user.id, project_id=project.id, action=action, resource_type="project",
                 resource_id=project.id, summary=f"Updated project '{project.name}'",
                 details={k: v for k, v in changes.items() if k != "description"})
    db.commit()
    return project


def delete_project(db: Session, user: User, project: Project) -> None:
    running = db.scalar(select(func.count()).select_from(Job).where(Job.project_id == project.id,
                                                                     Job.status == "running"))
    if running:
        raise Conflict("Project has running jobs; cancel them before deleting the project")
    project_id, name = project.id, project.name
    db.delete(project)
    audit.record(db, user_id=user.id, project_id=project_id, action="project.deleted", resource_type="project",
                 resource_id=project_id, summary=f"Deleted project '{name}'")
    db.commit()
    for area in ("uploads", "datasets", "exports"):
        shutil.rmtree(safe_path(area, project_id), ignore_errors=True)


def add_member(db: Session, actor: User, project: Project, email: str, role: str) -> ProjectMember:
    user = db.scalar(select(User).where(User.email == email.strip().lower()))
    if user is None:
        raise NotFound("No user with that email address")
    existing = db.get(ProjectMember, (project.id, user.id))
    if existing:
        existing.role = role
        member = existing
    else:
        member = ProjectMember(project_id=project.id, user_id=user.id, role=role)
        db.add(member)
    audit.record(db, user_id=actor.id, project_id=project.id, action="member.upserted", resource_type="member",
                 resource_id=user.id, summary=f"Set {user.email} as {role}")
    db.commit()
    db.refresh(member)
    return member


def remove_member(db: Session, actor: User, project: Project, user_id: str) -> None:
    member = db.get(ProjectMember, (project.id, user_id))
    if member is None:
        raise NotFound("Member not found")
    if member.role == "owner":
        owners = db.scalar(select(func.count()).select_from(ProjectMember).where(
            ProjectMember.project_id == project.id, ProjectMember.role == "owner"))
        if (owners or 0) <= 1:
            raise Conflict("A project must keep at least one owner")
    db.delete(member)
    audit.record(db, user_id=actor.id, project_id=project.id, action="member.removed", resource_type="member",
                 resource_id=user_id)
    db.commit()


def overview(db: Session, project: Project) -> dict[str, Any]:
    pid = project.id

    def count(model: Any, *conds: Any) -> int:
        return db.scalar(select(func.count()).select_from(model).where(model.project_id == pid, *conds)) or 0

    datasets = db.execute(
        select(Dataset, DatasetVersion)
        .outerjoin(DatasetVersion, (DatasetVersion.dataset_id == Dataset.id)
                   & (DatasetVersion.version == Dataset.current_version))
        .where(Dataset.project_id == pid)
    ).all()
    quality_scores = [v.profile["quality_score"] for _, v in datasets
                      if v is not None and v.profile and v.profile.get("quality_score") is not None]
    total_rows = sum(v.row_count for _, v in datasets if v is not None)
    activity = db.scalars(
        select(AuditLog).where(AuditLog.project_id == pid).order_by(AuditLog.created_at.desc()).limit(15)
    ).all()
    recent_jobs = db.scalars(select(Job).where(Job.project_id == pid).order_by(Job.created_at.desc()).limit(8)).all()
    return {
        "dataset_count": len(datasets),
        "dashboard_count": count(Dashboard),
        "saved_query_count": count(SavedQuery),
        "query_count": db.scalar(select(func.count()).select_from(QueryHistory).where(
            QueryHistory.project_id == pid)) or 0,
        "total_rows": total_rows,
        "avg_quality_score": round(sum(quality_scores) / len(quality_scores), 1) if quality_scores else None,
        "datasets_with_issues": sum(1 for s in quality_scores if s < 90),
        "failed_datasets": sum(1 for d, _ in datasets if d.status == "failed"),
        "activity": activity,
        "recent_jobs": recent_jobs,
    }
