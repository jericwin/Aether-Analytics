"""FastAPI dependencies for authentication and project-scoped authorization.

Resource ownership is never trusted from the client: every project-scoped operation resolves the
caller's membership from the database. Non-members receive 404 so project IDs cannot be probed."""

from dataclasses import dataclass
from typing import Annotated, Literal

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import Forbidden, NotFound, Unauthorized
from app.db.session import get_db
from app.models import Project, ProjectMember, User, UserSession
from app.security.auth import CSRF_HEADER, SESSION_COOKIE, csrf_matches, resolve_session

Role = Literal["viewer", "editor", "owner"]
ROLE_RANK: dict[str, int] = {"viewer": 1, "editor": 2, "owner": 3}
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

DbSession = Annotated[Session, Depends(get_db)]


@dataclass
class AuthContext:
    user: User
    session: UserSession


def get_auth(request: Request, db: DbSession) -> AuthContext:
    session = resolve_session(db, request.cookies.get(SESSION_COOKIE))
    if session is None:
        raise Unauthorized("Authentication required")
    if request.method not in SAFE_METHODS and not csrf_matches(session, request.headers.get(CSRF_HEADER)):
        raise Forbidden("Missing or invalid CSRF token", code="csrf_failed")
    return AuthContext(user=session.user, session=session)


Auth = Annotated[AuthContext, Depends(get_auth)]


@dataclass
class ProjectAccess:
    project: Project
    role: str
    user: User


def load_project_access(db: Session, user: User, project_id: str, min_role: Role = "viewer") -> ProjectAccess:
    row = db.execute(
        select(Project, ProjectMember.role)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(Project.id == project_id, ProjectMember.user_id == user.id)
    ).first()
    if row is None:
        raise NotFound("Project not found")
    project, role = row
    if ROLE_RANK[role] < ROLE_RANK[min_role]:
        raise Forbidden(f"This action requires the '{min_role}' role on the project")
    return ProjectAccess(project=project, role=role, user=user)


def project_access(min_role: Role):  # type: ignore[no-untyped-def]
    def _dep(project_id: str, auth: Auth, db: DbSession) -> ProjectAccess:
        return load_project_access(db, auth.user, project_id, min_role)

    return _dep


ProjectViewer = Annotated[ProjectAccess, Depends(project_access("viewer"))]
ProjectEditor = Annotated[ProjectAccess, Depends(project_access("editor"))]
ProjectOwner = Annotated[ProjectAccess, Depends(project_access("owner"))]
