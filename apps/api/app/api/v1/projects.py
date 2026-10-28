from typing import Annotated, Literal

from fastapi import APIRouter, Query, Response
from sqlalchemy import select

from app.models import AuditLog, ProjectMember
from app.schemas import (
    AuditOut,
    MemberIn,
    MemberOut,
    Page,
    ProjectIn,
    ProjectOut,
    ProjectOverview,
    ProjectPatch,
)
from app.security.deps import Auth, DbSession, ProjectEditor, ProjectOwner, ProjectViewer
from app.services import projects as svc

router = APIRouter(prefix="/projects", tags=["projects"])


def _out(project, role: str) -> ProjectOut:  # type: ignore[no-untyped-def]
    out = ProjectOut.model_validate(project)
    out.role = role
    return out


@router.get("", response_model=Page[ProjectOut])
def list_projects(
    auth: Auth,
    db: DbSession,
    search: Annotated[str | None, Query(max_length=120)] = None,
    status: Literal["active", "archived"] | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[ProjectOut]:
    rows, total = svc.list_projects(db, auth.user, search=search, status=status, limit=limit, offset=offset)
    return Page(items=[_out(p, r) for p, r in rows], total=total, limit=limit, offset=offset)


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectIn, auth: Auth, db: DbSession) -> ProjectOut:
    return _out(svc.create_project(db, auth.user, body.name, body.description), "owner")


@router.post("/demo", response_model=ProjectOut, status_code=201)
def create_demo(auth: Auth, db: DbSession, seed: Annotated[int, Query(ge=0, le=2**31)] = 42) -> ProjectOut:
    """Opt-in: create a separate project with synthetic retail data and a sample dashboard."""
    from app.demo import create_demo_project

    return _out(create_demo_project(db, auth.user, seed), "owner")


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(access: ProjectViewer) -> ProjectOut:
    return _out(access.project, access.role)


@router.get("/{project_id}/overview", response_model=ProjectOverview)
def project_overview(access: ProjectViewer, db: DbSession) -> ProjectOverview:
    data = svc.overview(db, access.project)
    return ProjectOverview(project=_out(access.project, access.role), **data)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(body: ProjectPatch, access: ProjectEditor, db: DbSession) -> ProjectOut:
    changes = body.model_dump(exclude_unset=True)
    if "status" in changes and access.role != "owner":
        from app.core.errors import Forbidden

        raise Forbidden("Only owners can archive or restore a project")
    return _out(svc.update_project(db, access.user, access.project, changes), access.role)


@router.delete("/{project_id}", status_code=204)
def delete_project(access: ProjectOwner, db: DbSession) -> Response:
    svc.delete_project(db, access.user, access.project)
    return Response(status_code=204)


@router.get("/{project_id}/activity", response_model=Page[AuditOut])
def activity(access: ProjectViewer, db: DbSession, limit: Annotated[int, Query(ge=1, le=200)] = 50,
             offset: Annotated[int, Query(ge=0)] = 0) -> Page[AuditOut]:
    from sqlalchemy import func

    base = select(AuditLog).where(AuditLog.project_id == access.project.id)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    items = db.scalars(base.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)).all()
    return Page(items=[AuditOut.model_validate(a) for a in items], total=total, limit=limit, offset=offset)


@router.get("/{project_id}/members", response_model=list[MemberOut])
def list_members(access: ProjectViewer, db: DbSession) -> list[MemberOut]:
    members = db.scalars(select(ProjectMember).where(ProjectMember.project_id == access.project.id)).all()
    return [MemberOut(user_id=m.user_id, role=m.role, created_at=m.created_at, email=m.user.email,
                      display_name=m.user.display_name) for m in members]


@router.put("/{project_id}/members", response_model=MemberOut)
def upsert_member(body: MemberIn, access: ProjectOwner, db: DbSession) -> MemberOut:
    m = svc.add_member(db, access.user, access.project, body.email, body.role)
    return MemberOut(user_id=m.user_id, role=m.role, created_at=m.created_at, email=m.user.email,
                     display_name=m.user.display_name)


@router.delete("/{project_id}/members/{user_id}", status_code=204)
def remove_member(user_id: str, access: ProjectOwner, db: DbSession) -> Response:
    svc.remove_member(db, access.user, access.project, user_id)
    return Response(status_code=204)
