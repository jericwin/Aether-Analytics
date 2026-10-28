"""Password hashing, server-side sessions and CSRF protection.

Sessions: an opaque random token is stored in an HttpOnly cookie; only its SHA-256 hash is persisted.
CSRF: a per-session token is exposed in a readable cookie and must be echoed in the X-CSRF-Token
header on every state-changing request (double submit, verified against the server-side value)."""

import hashlib
import hmac
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError
from app.models import User, UserSession

SESSION_COOKIE = "aether_session"
CSRF_COOKIE = "aether_csrf"
CSRF_HEADER = "X-CSRF-Token"

_hasher = PasswordHasher()
# Used to equalise timing when the email does not exist.
_DUMMY_HASH = _hasher.hash("timing-equaliser-not-a-password")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def authenticate(db: Session, email: str, password: str) -> User | None:
    user = db.scalar(select(User).where(User.email == email.strip().lower()))
    if user is None:
        verify_password(_DUMMY_HASH, password)
        return None
    if not user.is_active or not verify_password(user.password_hash, password):
        return None
    return user


def create_session(db: Session, user: User, user_agent: str | None) -> tuple[str, UserSession]:
    token = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    session = UserSession(
        user_id=user.id,
        token_hash=_hash_token(token),
        csrf_token=secrets.token_urlsafe(32),
        expires_at=now + timedelta(hours=get_settings().session_ttl_hours),
        user_agent=(user_agent or "")[:255] or None,
    )
    db.add(session)
    # Opportunistic cleanup of this user's expired sessions.
    db.execute(delete(UserSession).where(UserSession.user_id == user.id, UserSession.expires_at < now))
    return token, session


def resolve_session(db: Session, token: str | None) -> UserSession | None:
    if not token:
        return None
    session = db.scalar(select(UserSession).where(UserSession.token_hash == _hash_token(token)))
    if session is None:
        return None
    expires = session.expires_at if session.expires_at.tzinfo else session.expires_at.replace(tzinfo=UTC)
    if expires < datetime.now(UTC) or not session.user.is_active:
        return None
    return session


def csrf_matches(session: UserSession, header_value: str | None) -> bool:
    return bool(header_value) and hmac.compare_digest(session.csrf_token, header_value or "")


def set_session_cookies(response: Response, token: str, session: UserSession) -> None:
    settings = get_settings()
    max_age = settings.session_ttl_hours * 3600
    response.set_cookie(SESSION_COOKIE, token, max_age=max_age, httponly=True, secure=settings.cookie_secure,
                        samesite="lax", path="/")
    response.set_cookie(CSRF_COOKIE, session.csrf_token, max_age=max_age, httponly=False,
                        secure=settings.cookie_secure, samesite="lax", path="/")


def clear_session_cookies(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")


class RateLimiter:
    """In-process sliding-window limiter. Adequate for the single-node local deployment; a shared
    store (e.g. Redis) is required if the API is scaled horizontally."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window_seconds: float = 60.0) -> None:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > window_seconds:
                hits.popleft()
            if len(hits) >= limit:
                raise AppError("Too many attempts. Try again shortly.", code="rate_limited", status_code=429)
            hits.append(now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


auth_rate_limiter = RateLimiter()
