import hashlib
import io
import os
import re
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, BinaryIO

import polars as pl
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.analytics import profiling, query_engine, sql_builder, sql_guard
from app.core.config import get_settings
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.storage import dataset_version_path, from_relative, new_upload_path, safe_path, to_relative
from app.ingestion import formats
from app.ingestion.adapters import ImportOptions, get_adapter, load_frame
from app.ingestion.schema import logical_type
from app.models import (
    DashboardFilter,
    DashboardWidget,
    Dataset,
    DatasetColumn,
    DatasetVersion,
    DataSource,
    Job,
    Project,
    User,
)
from app.services import audit
from app.workers import queue

TABLE_NAME_RE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")
RESERVED = {"select", "from", "where", "table", "order", "group", "by", "join", "union", "with", "limit",
            "offset", "and", "or", "not", "null", "true", "false", "as", "on", "in", "is", "case", "when",
            "then", "else", "end", "having", "distinct", "all", "any", "create", "drop", "insert", "update",
            "delete", "values", "into", "default", "user", "range", "window", "over"}
PREVIEW_ROWS = 50
EXPORT_MAX_ROWS = 1_000_000


# --------------------------------------------------------------------------- helpers
def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def slugify_table_name(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_") or "dataset"
    if slug[0].isdigit():
        slug = f"t_{slug}"
    slug = slug[:63]
    return f"{slug}_data" if slug in RESERVED else slug


def _unique_table_name(db: Session, project_id: str, base: str) -> str:
    existing = set(db.scalars(select(Dataset.table_name).where(Dataset.project_id == project_id)).all())
    name, n = base, 2
    while name in existing:
        suffix = f"_{n}"
        name = base[: 63 - len(suffix)] + suffix
        n += 1
    return name


def get_dataset(db: Session, project_id: str, dataset_id: str) -> Dataset:
    ds = db.get(Dataset, dataset_id)
    if ds is None or ds.project_id != project_id:
        raise NotFound("Dataset not found")
    return ds


def get_version(db: Session, ds: Dataset, version: int | None = None) -> DatasetVersion:
    number = version or ds.current_version
    if number is None:
        raise Conflict("Dataset has no imported version yet", code="dataset_not_ready")
    v = db.scalar(select(DatasetVersion).where(DatasetVersion.dataset_id == ds.id,
                                               DatasetVersion.version == number))
    if v is None:
        raise NotFound(f"Version {number} not found")
    return v


def column_types(version: DatasetVersion) -> dict[str, str]:
    return {c.name: c.logical_type for c in version.columns}


def project_tables(db: Session, project_id: str) -> dict[str, Path]:
    """table_name -> parquet path of the current version of every ready dataset in the project."""
    rows = db.execute(
        select(Dataset.table_name, DatasetVersion.storage_path)
        .join(DatasetVersion, (DatasetVersion.dataset_id == Dataset.id)
              & (DatasetVersion.version == Dataset.current_version))
        .where(Dataset.project_id == project_id)
    ).all()
    return {name: from_relative(path) for name, path in rows}


# --------------------------------------------------------------------------- upload & preview
def save_upload(db: Session, project: Project, user: User, filename: str, stream: BinaryIO) -> DataSource:
    settings = get_settings()
    safe_name = Path(filename or "upload").name[:255]
    declared = formats.format_for_extension(safe_name)
    path = new_upload_path(project.id, Path(safe_name).suffix or declared)
    limit = settings.max_upload_mb * 1024 * 1024
    size = 0
    digest = hashlib.sha256()
    try:
        with path.open("wb") as out:
            while chunk := stream.read(1 << 20):
                size += len(chunk)
                if size > limit:
                    raise ValidationFailed(f"File exceeds the {settings.max_upload_mb} MB upload limit",
                                           code="file_too_large", status_code=413)
                digest.update(chunk)
                out.write(chunk)
        fmt = formats.detect_format(path, declared)
        detected = get_adapter(fmt).inspect(path)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    source = DataSource(project_id=project.id, original_filename=safe_name, storage_path=to_relative(path),
                        file_format=fmt, size_bytes=size, content_hash=digest.hexdigest(), detected=detected,
                        created_by=user.id)
    db.add(source)
    audit.record(db, user_id=user.id, project_id=project.id, action="file.uploaded", resource_type="data_source",
                 resource_id=source.id, summary=f"Uploaded {safe_name}", details={"size_bytes": size})
    db.commit()
    return source


def get_source(db: Session, project_id: str, source_id: str) -> DataSource:
    src = db.get(DataSource, source_id)
    if src is None or src.project_id != project_id:
        raise NotFound("Upload not found")
    return src


def preview_source(source: DataSource, options: ImportOptions) -> dict[str, Any]:
    df, warnings = load_frame(from_relative(source.storage_path), source.file_format, options, n_rows=PREVIEW_ROWS)
    return {
        "columns": [{"name": n, "logical_type": logical_type(t), "physical_type": str(t)}
                    for n, t in df.schema.items()],
        "rows": [[profiling.json_safe(v) for v in row] for row in df.iter_rows()],
        "warnings": warnings,
        "sample_size": df.height,
        "detected": source.detected,
    }


# --------------------------------------------------------------------------- import
def start_import(db: Session, project: Project, user: User, source: DataSource, name: str,
                 table_name: str | None, description: str | None, options: ImportOptions) -> tuple[Dataset, Job]:
    if table_name:
        if not TABLE_NAME_RE.match(table_name) or table_name in RESERVED:
            raise ValidationFailed("Table name must be lowercase letters, digits and underscores, not a SQL keyword",
                                   code="invalid_table_name")
        if db.scalar(select(Dataset.id).where(Dataset.project_id == project.id, Dataset.table_name == table_name)):
            raise Conflict(f"A dataset with table name '{table_name}' already exists")
    else:
        table_name = _unique_table_name(db, project.id, slugify_table_name(name))
    ds = Dataset(project_id=project.id, name=name.strip(), table_name=table_name, description=description,
                 source_id=source.id, created_by=user.id, status="importing")
    db.add(ds)
    db.flush()
    audit.record(db, user_id=user.id, project_id=project.id, action="dataset.import_started",
                 resource_type="dataset", resource_id=ds.id,
                 summary=f"Importing '{ds.name}' from {source.original_filename}")
    job = queue.enqueue(db, job_type="dataset_import", project_id=project.id, user_id=user.id,
                        payload={"dataset_id": ds.id, "source_id": source.id, "options": options.model_dump()})
    db.refresh(ds)
    return ds, job


def start_reimport(db: Session, project: Project, user: User, ds: Dataset, source: DataSource,
                   options: ImportOptions) -> Job:
    """Import a new file as the next version of an existing dataset."""
    if db.scalar(select(func.count()).select_from(Job).where(
            Job.status.in_(["pending", "running"]), Job.job_type == "dataset_import",
            Job.project_id == project.id, Job.payload["dataset_id"].as_string() == ds.id)):
        raise Conflict("An import for this dataset is already in progress")
    audit.record(db, user_id=user.id, project_id=project.id, action="dataset.version_started",
                 resource_type="dataset", resource_id=ds.id, summary=f"New version of '{ds.name}'")
    return queue.enqueue(db, job_type="dataset_import", project_id=project.id, user_id=user.id,
                         payload={"dataset_id": ds.id, "source_id": source.id, "options": options.model_dump()})


def run_import(ctx: queue.JobContext) -> dict[str, Any]:
    """Worker side of an import: parse -> refine -> write immutable Parquet -> profile -> register."""
    from app.db.session import get_sessionmaker

    payload = ctx.payload
    options = ImportOptions.model_validate(payload["options"])
    with get_sessionmaker()() as db:
        ds = db.get(Dataset, payload["dataset_id"])
        source = db.get(DataSource, payload["source_id"])
        if ds is None or source is None:
            raise NotFound("Dataset or upload no longer exists")
        project_id, dataset_id = ds.project_id, ds.id
        next_version = (db.scalar(select(func.max(DatasetVersion.version)).where(
            DatasetVersion.dataset_id == ds.id)) or 0) + 1
        src_path, fmt = from_relative(source.storage_path), source.file_format

    ctx.progress(0.05, f"Reading {fmt.upper()} file")
    df, warnings = load_frame(src_path, fmt, options)
    ctx.progress(0.45, f"Parsed {df.height:,} rows × {df.width} columns; writing Parquet")

    final = dataset_version_path(project_id, dataset_id, next_version)
    tmp = final.with_suffix(".parquet.tmp")
    df.write_parquet(tmp, compression="zstd", statistics=True)
    os.replace(tmp, final)  # atomic publish of the immutable version file
    content_hash = _sha256(final)
    size_bytes = final.stat().st_size
    null_counts = df.null_count().row(0)
    schema = list(df.schema.items())
    del df

    ctx.progress(0.6, "Profiling columns")
    profile = profiling.profile_parquet(final)
    ctx.progress(0.95, "Registering dataset version")

    with get_sessionmaker()() as db:
        ds = db.get(Dataset, dataset_id)
        if ds is None:  # deleted while importing
            final.unlink(missing_ok=True)
            raise NotFound("Dataset was deleted during import")
        version = DatasetVersion(
            dataset_id=ds.id, version=next_version, storage_path=to_relative(final), size_bytes=size_bytes,
            row_count=profile["row_count"], column_count=len(schema), content_hash=content_hash,
            source_id=payload["source_id"], import_options=options.model_dump(), warnings=warnings,
            job_id=ctx.job_id, profile=profile, profiled_at=datetime.now(UTC),
        )
        version.columns = [
            DatasetColumn(position=i, name=n, logical_type=logical_type(t), physical_type=str(t),
                          null_count=int(null_counts[i]))
            for i, (n, t) in enumerate(schema)
        ]
        db.add(version)
        ds.current_version, ds.status, ds.error_message = next_version, "ready", None
        ds.source_id = payload["source_id"]
        ds.updated_at = datetime.now(UTC)
        audit.record(db, user_id=ctx.user_id, project_id=project_id, action="dataset.imported",
                     resource_type="dataset", resource_id=ds.id,
                     summary=f"Imported '{ds.name}' v{next_version} ({profile['row_count']:,} rows)")
        db.commit()
    return {"dataset_id": dataset_id, "version": next_version, "row_count": profile["row_count"],
            "warnings": warnings}


def on_import_failed(ctx: queue.JobContext, message: str) -> None:
    from app.db.session import get_sessionmaker

    with get_sessionmaker()() as db:
        ds = db.get(Dataset, ctx.payload.get("dataset_id"))
        if ds is not None and ds.current_version is None:
            ds.status, ds.error_message = "failed", message[:2000]
            db.commit()


def reprofile(db: Session, version: DatasetVersion) -> dict[str, Any]:
    profile = profiling.profile_parquet(from_relative(version.storage_path))
    version.profile, version.profiled_at = profile, datetime.now(UTC)
    db.commit()
    return profile


# --------------------------------------------------------------------------- browsing
def browse_rows(db: Session, ds: Dataset, version: DatasetVersion, *, offset: int, limit: int,
                sort: list[tuple[str, str]], filters: list[sql_builder.ColumnFilter],
                columns: list[str] | None) -> dict[str, Any]:
    types = column_types(version)
    selected = columns or list(types)
    for c in selected:
        sql_builder.resolve_column(types, c)
    table = "t"
    where = sql_builder.where_clause(types, filters)
    order = ""
    if sort:
        parts = []
        for col, direction in sort:
            sql_builder.resolve_column(types, col)
            parts.append(f"{sql_builder.ident(col)} {'DESC' if direction == 'desc' else 'ASC'} NULLS LAST")
        order = " ORDER BY " + ", ".join(parts)
    select_list = ", ".join(sql_builder.ident(c) for c in selected)
    data_sql = f"SELECT {select_list} FROM {table}{where}{order} LIMIT {int(limit)} OFFSET {int(offset)}"
    count_sql = f"SELECT count(*) AS n FROM {table}{where}"
    tables = {table: from_relative(version.storage_path)}
    validated = sql_guard.validate_query(data_sql, set(tables))
    result = query_engine.execute(validated.sql, tables, max_rows=limit)
    total = query_engine.execute(sql_guard.validate_query(count_sql, set(tables)).sql, tables, max_rows=1).rows[0][0]
    return {"columns": result.columns, "rows": result.rows, "total": total, "offset": offset, "limit": limit,
            "duration_ms": result.duration_ms}


def export_csv(db: Session, ds: Dataset, version: DatasetVersion, filters: list[sql_builder.ColumnFilter],
               columns: list[str] | None) -> tuple[bytes, bool]:
    types = column_types(version)
    selected = columns or list(types)
    for c in selected:
        sql_builder.resolve_column(types, c)
    sql = f"SELECT {', '.join(sql_builder.ident(c) for c in selected)} FROM t{sql_builder.where_clause(types, filters)}"
    tables = {"t": from_relative(version.storage_path)}
    arrow, truncated, _ = query_engine.execute_arrow(sql_guard.validate_query(sql, {"t"}).sql, tables,
                                                     max_rows=EXPORT_MAX_ROWS)
    buf = io.BytesIO()
    frame = pl.from_arrow(arrow)
    assert isinstance(frame, pl.DataFrame)
    frame.write_csv(buf)
    return buf.getvalue(), truncated


# --------------------------------------------------------------------------- mutation
def dependents(db: Session, ds: Dataset) -> list[dict[str, str]]:
    from app.models import Dashboard

    rows = db.execute(
        select(Dashboard.id, Dashboard.name, DashboardWidget.title)
        .join(DashboardWidget, DashboardWidget.dashboard_id == Dashboard.id)
        .where(DashboardWidget.dataset_id == ds.id)
    ).all()
    deps = [{"type": "dashboard_widget", "dashboard_id": d, "dashboard": n, "title": t} for d, n, t in rows]
    frows = db.execute(
        select(Dashboard.id, Dashboard.name, DashboardFilter.label)
        .join(DashboardFilter, DashboardFilter.dashboard_id == Dashboard.id)
        .where(DashboardFilter.dataset_id == ds.id)
    ).all()
    deps += [{"type": "dashboard_filter", "dashboard_id": d, "dashboard": n, "title": t} for d, n, t in frows]
    return deps


def rename_dataset(db: Session, user: User, ds: Dataset, name: str | None, description: str | None) -> Dataset:
    if name:
        ds.name = name.strip()
    if description is not None:
        ds.description = description
    audit.record(db, user_id=user.id, project_id=ds.project_id, action="dataset.updated", resource_type="dataset",
                 resource_id=ds.id, summary=f"Updated dataset '{ds.name}'")
    db.commit()
    return ds


def delete_dataset(db: Session, user: User, ds: Dataset) -> None:
    deps = dependents(db, ds)
    if deps:
        raise Conflict("Dataset is used by dashboards. Remove those widgets/filters first.", code="dataset_in_use",
                       details=deps)
    if db.scalar(select(func.count()).select_from(Job).where(
            Job.status.in_(["pending", "running"]), Job.project_id == ds.project_id,
            Job.payload["dataset_id"].as_string() == ds.id)):
        raise Conflict("An import for this dataset is still running")
    project_id, dataset_id, name = ds.project_id, ds.id, ds.name
    db.delete(ds)
    audit.record(db, user_id=user.id, project_id=project_id, action="dataset.deleted", resource_type="dataset",
                 resource_id=dataset_id, summary=f"Deleted dataset '{name}'")
    db.commit()
    shutil.rmtree(safe_path("datasets", project_id, dataset_id), ignore_errors=True)
