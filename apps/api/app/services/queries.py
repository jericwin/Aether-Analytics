"""SQL workbench service: validation -> scoped execution -> history."""

import io
import time
from typing import Any

import polars as pl
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.analytics import query_engine, sql_guard
from app.core.config import get_settings
from app.core.errors import AppError, NotFound
from app.models import Dataset, DatasetVersion, Project, QueryHistory, SavedQuery, User
from app.services import audit, datasets


def schema_catalog(db: Session, project_id: str) -> list[dict[str, Any]]:
    rows = db.execute(
        select(Dataset, DatasetVersion)
        .join(DatasetVersion, (DatasetVersion.dataset_id == Dataset.id)
              & (DatasetVersion.version == Dataset.current_version))
        .where(Dataset.project_id == project_id)
        .order_by(Dataset.table_name)
    ).all()
    return [
        {
            "dataset_id": ds.id,
            "table_name": ds.table_name,
            "name": ds.name,
            "version": v.version,
            "row_count": v.row_count,
            "columns": [{"name": c.name, "logical_type": c.logical_type, "physical_type": c.physical_type}
                        for c in v.columns],
        }
        for ds, v in rows
    ]


def _record(db: Session, project_id: str, user_id: str, sql: str, status: str, *, duration_ms: int | None = None,
            row_count: int | None = None, truncated: bool = False, error: str | None = None) -> QueryHistory:
    entry = QueryHistory(project_id=project_id, user_id=user_id, sql=sql[:20000], status=status,
                         duration_ms=duration_ms, row_count=row_count, truncated=truncated, error_message=error)
    db.add(entry)
    db.commit()
    return entry


def run_query(db: Session, project: Project, user: User, sql: str, *, max_rows: int | None,
              client_query_id: str | None) -> dict[str, Any]:
    settings = get_settings()
    max_rows = min(max_rows or settings.max_result_rows, settings.max_result_rows)
    tables = datasets.project_tables(db, project.id)
    start = time.perf_counter()
    try:
        validated = sql_guard.validate_query(sql, set(tables))
    except AppError as exc:
        _record(db, project.id, user.id, sql, "rejected", error=exc.message)
        raise
    # Execution key is namespaced by user so one user cannot cancel another's query.
    key = f"{user.id}:{client_query_id}" if client_query_id else None
    try:
        result = query_engine.execute(validated.sql, {t: tables[t] for t in validated.tables},
                                      max_rows=max_rows, key=key)
    except query_engine.QueryCancelled as exc:
        _record(db, project.id, user.id, sql, "cancelled", error=exc.message,
                duration_ms=int((time.perf_counter() - start) * 1000))
        raise
    except AppError as exc:
        _record(db, project.id, user.id, sql, "failed", error=exc.message,
                duration_ms=int((time.perf_counter() - start) * 1000))
        raise
    entry = _record(db, project.id, user.id, sql, "succeeded", duration_ms=result.duration_ms,
                    row_count=result.row_count, truncated=result.truncated)
    return {
        "history_id": entry.id,
        "columns": result.columns,
        "rows": result.rows,
        "row_count": result.row_count,
        "truncated": result.truncated,
        "max_rows": max_rows,
        "duration_ms": result.duration_ms,
        "tables": sorted(validated.tables),
    }


def cancel_query(user: User, client_query_id: str) -> bool:
    return query_engine.cancel(f"{user.id}:{client_query_id}")


def export_query_csv(db: Session, project: Project, sql: str) -> tuple[bytes, bool]:
    tables = datasets.project_tables(db, project.id)
    validated = sql_guard.validate_query(sql, set(tables))
    arrow, truncated, _ = query_engine.execute_arrow(validated.sql, {t: tables[t] for t in validated.tables},
                                                     max_rows=datasets.EXPORT_MAX_ROWS)
    frame = pl.from_arrow(arrow)
    assert isinstance(frame, pl.DataFrame)
    buf = io.BytesIO()
    frame.write_csv(buf)
    return buf.getvalue(), truncated


def get_saved(db: Session, project_id: str, query_id: str) -> SavedQuery:
    q = db.get(SavedQuery, query_id)
    if q is None or q.project_id != project_id:
        raise NotFound("Saved query not found")
    return q


def save_query(db: Session, project: Project, user: User, name: str, sql: str, description: str | None) -> SavedQuery:
    q = SavedQuery(project_id=project.id, name=name.strip(), sql=sql, description=description, created_by=user.id)
    db.add(q)
    audit.record(db, user_id=user.id, project_id=project.id, action="query.saved", resource_type="saved_query",
                 resource_id=q.id, summary=f"Saved query '{q.name}'")
    db.commit()
    return q
