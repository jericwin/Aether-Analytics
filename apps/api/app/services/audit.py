from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog


def record(db: Session, *, user_id: str | None, project_id: str | None, action: str, resource_type: str,
           resource_id: str | None = None, summary: str | None = None, details: dict[str, Any] | None = None) -> None:
    """Add an audit entry to the current transaction (committed with the change it describes)."""
    db.add(AuditLog(user_id=user_id, project_id=project_id, action=action, resource_type=resource_type,
                    resource_id=resource_id, summary=(summary or "")[:255] or None, details=details or {}))
