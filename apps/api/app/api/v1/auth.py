from fastapi import APIRouter, Request, Response
from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.errors import Conflict, Forbidden, Unauthorized
from app.models import User
from app.schemas import AuthStatus, LoginIn, RegisterIn, UserOut
from app.security.auth import (
    SESSION_COOKIE,
    auth_rate_limiter,
    authenticate,
    clear_session_cookies,
    create_session,
    hash_password,
    resolve_session,
    set_session_cookies,
)
from app.security.deps import Auth, DbSession
from app.services import audit

router = APIRouter(prefix="/auth", tags=["auth"])


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.get("/status", response_model=AuthStatus)
def status(request: Request, db: DbSession) -> AuthStatus:
    session = resolve_session(db, request.cookies.get(SESSION_COOKIE))
    has_users = bool(db.scalar(select(func.count()).select_from(User)))
    return AuthStatus(
        user=UserOut.model_validate(session.user) if session else None,
        registration_open=get_settings().allow_registration or not has_users,
        has_users=has_users,
    )


@router.post("/register", response_model=UserOut, status_code=201)
def register(body: RegisterIn, request: Request, response: Response, db: DbSession) -> User:
    auth_rate_limiter.check(f"register:{_client_ip(request)}", get_settings().rate_limit_auth_per_minute)
    has_users = bool(db.scalar(select(func.count()).select_from(User)))
    if has_users and not get_settings().allow_registration:
        raise Forbidden("Registration is disabled on this instance", code="registration_closed")
    email = body.email.lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise Conflict("An account with this email already exists", code="email_taken")
    user = User(email=email, display_name=body.display_name.strip(), password_hash=hash_password(body.password))
    db.add(user)
    db.flush()
    token, session = create_session(db, user, request.headers.get("user-agent"))
    audit.record(db, user_id=user.id, project_id=None, action="user.registered", resource_type="user",
                 resource_id=user.id)
    db.commit()
    set_session_cookies(response, token, session)
    return user


@router.post("/login", response_model=UserOut)
def login(body: LoginIn, request: Request, response: Response, db: DbSession) -> User:
    limit = get_settings().rate_limit_auth_per_minute
    auth_rate_limiter.check(f"login:{_client_ip(request)}", limit * 3)
    auth_rate_limiter.check(f"login:{body.email.lower()}", limit)
    user = authenticate(db, body.email, body.password)
    if user is None:
        raise Unauthorized("Invalid email or password", code="invalid_credentials")
    token, session = create_session(db, user, request.headers.get("user-agent"))
    audit.record(db, user_id=user.id, project_id=None, action="user.login", resource_type="user", resource_id=user.id)
    db.commit()
    set_session_cookies(response, token, session)
    return user


@router.post("/logout", status_code=204)
def logout(auth: Auth, response: Response, db: DbSession) -> Response:
    db.delete(auth.session)
    db.commit()
    clear_session_cookies(response)
    response.status_code = 204
    return response


@router.get("/me", response_model=UserOut)
def me(auth: Auth) -> User:
    return auth.user
