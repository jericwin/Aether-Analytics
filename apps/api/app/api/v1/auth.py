import secrets
from datetime import timedelta

from fastapi import APIRouter, Request, Response
from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.errors import BadRequest, Conflict, Forbidden, Unauthorized
from app.db.base import utcnow
from app.models import EmailVerification, User
from app.schemas import AuthStatus, LoginIn, RegisterIn, SendCodeIn, SendCodeOut, UserOut
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
from app.services.email import send_verification_email

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


@router.post("/send-code", response_model=SendCodeOut)
def send_code(body: SendCodeIn, request: Request, db: DbSession) -> SendCodeOut:
    auth_rate_limiter.check(f"send_code:{_client_ip(request)}", get_settings().rate_limit_auth_per_minute)
    email = body.email.strip().lower()
    auth_rate_limiter.check(f"send_code:{email}", 5)

    has_users = bool(db.scalar(select(func.count()).select_from(User)))
    if has_users and not get_settings().allow_registration:
        raise Forbidden("Registration is disabled on this instance", code="registration_closed")

    if db.scalar(select(User.id).where(User.email == email)):
        raise Conflict("An account with this email already exists", code="email_taken")

    now = utcnow()
    prior_codes = db.scalars(
        select(EmailVerification).where(
            EmailVerification.email == email,
            EmailVerification.used_at.is_(None),
            EmailVerification.expires_at > now,
        )
    ).all()
    for pc in prior_codes:
        pc.used_at = now

    code = f"{secrets.randbelow(1_000_000):06d}"
    ttl = get_settings().verification_code_ttl_minutes
    expires_at = now + timedelta(minutes=ttl)

    record = EmailVerification(
        email=email,
        code=code,
        created_at=now,
        expires_at=expires_at,
        used_at=None,
        attempts=0,
    )
    db.add(record)
    db.commit()

    send_verification_email(email, code)

    settings = get_settings()
    preview = code if not (settings.smtp_host and settings.smtp_user) else None
    return SendCodeOut(
        sent=True,
        message=f"Verification code sent to {email}",
        preview_code=preview,
    )


@router.post("/register", response_model=UserOut, status_code=201)
def register(body: RegisterIn, request: Request, response: Response, db: DbSession) -> User:
    auth_rate_limiter.check(f"register:{_client_ip(request)}", get_settings().rate_limit_auth_per_minute)
    has_users = bool(db.scalar(select(func.count()).select_from(User)))
    if has_users and not get_settings().allow_registration:
        raise Forbidden("Registration is disabled on this instance", code="registration_closed")
    email = body.email.strip().lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise Conflict("An account with this email already exists", code="email_taken")

    if get_settings().require_email_verification:
        if not body.code or not body.code.strip():
            raise BadRequest("Verification code is required", code="code_required")

        now = utcnow()
        verification = db.scalar(
            select(EmailVerification)
            .where(
                EmailVerification.email == email,
                EmailVerification.used_at.is_(None),
                EmailVerification.expires_at > now,
            )
            .order_by(EmailVerification.created_at.desc())
        )
        if not verification:
            raise BadRequest("Verification code expired or not found. Please request a new code.", code="invalid_code")

        if verification.attempts >= 5:
            verification.used_at = now
            db.commit()
            raise BadRequest("Too many failed attempts. Please request a new code.", code="code_locked")

        verification.attempts += 1
        if not secrets.compare_digest(verification.code, body.code.strip()):
            db.commit()
            raise BadRequest("Invalid verification code", code="invalid_code")

        verification.used_at = now

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
