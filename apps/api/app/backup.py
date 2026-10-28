"""Backup and restore of metadata + analytical storage into a single .zip archive.

Archive layout:
    manifest.json              format version, timestamp, database backend, alembic revision
    metadata.sqlite            SQLite profile: consistent online copy via the SQLite backup API
    metadata.pgdump            PostgreSQL profile: `pg_dump --format=custom` output
    storage/...                uploads, dataset Parquet versions, exports

Restore refuses to overwrite a non-empty target unless `force=True`, and runs migrations
afterwards so an older backup is upgraded to the current schema."""

import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
import zipfile
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import make_url

from app.core.config import get_settings
from app.db.session import get_engine

FORMAT_VERSION = 1
STORAGE_AREAS = ("uploads", "datasets", "exports")


def _sqlite_path() -> Path:
    db = make_url(get_settings().database_url).database
    if not db:
        raise RuntimeError("SQLite database path is not configured")
    return Path(db)


def _revision() -> str | None:
    with get_engine().connect() as conn:
        try:
            return conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
        except Exception:
            return None


def _has_existing_data(root: Path) -> bool:
    files = any(f.is_file() for a in STORAGE_AREAS if (root / a).exists() for f in (root / a).rglob("*"))
    try:
        with get_engine().connect() as conn:
            projects = conn.execute(text("SELECT count(*) FROM projects")).scalar() or 0
    except Exception:  # no schema yet: a fresh instance
        projects = 0
    return files or projects > 0


def _run_pg_tool(tool: str, *args: str) -> None:
    """Run pg_dump/pg_restore. The password goes through PGPASSWORD, never argv, so it cannot leak
    into process listings, tracebacks or logs. Errors surface pg's own message (no credentials)."""
    url = make_url(get_settings().database_url)
    env = {**os.environ, "PGPASSWORD": url.password or ""}
    conn = ["-h", url.host or "localhost", "-p", str(url.port or 5432), "-U", url.username or "postgres"]
    proc = subprocess.run([tool, *conn, *args], env=env, capture_output=True, text=True)
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout).strip().splitlines()[-3:]
        raise RuntimeError(f"{tool} failed: " + " | ".join(detail))


def create_backup(out: Path) -> Path:
    settings = get_settings()
    out = out.with_suffix(".zip") if out.suffix != ".zip" else out
    out.parent.mkdir(parents=True, exist_ok=True)
    manifest = {
        "format_version": FORMAT_VERSION,
        "created_at": datetime.now(UTC).isoformat(),
        "database": "sqlite" if settings.is_sqlite else "postgresql",
        "alembic_revision": _revision(),
    }
    with tempfile.TemporaryDirectory() as tmp, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        if settings.is_sqlite:
            dump = Path(tmp) / "metadata.sqlite"
            src = sqlite3.connect(_sqlite_path())
            dst = sqlite3.connect(dump)
            with dst:
                src.backup(dst)  # consistent snapshot even while the app is running
            src.close()
            dst.close()
            zf.write(dump, "metadata.sqlite")
        else:
            dump = Path(tmp) / "metadata.pgdump"
            _run_pg_tool("pg_dump", "--format=custom", f"--file={dump}",
                         make_url(settings.database_url).database or "")
            zf.write(dump, "metadata.pgdump")
        root = settings.storage_dir.resolve()
        for area in STORAGE_AREAS:
            base = root / area
            if base.exists():
                for f in base.rglob("*"):
                    if f.is_file() and not f.name.endswith(".tmp"):
                        zf.write(f, f"storage/{f.relative_to(root).as_posix()}")
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))
    return out


def restore_backup(archive: Path, *, force: bool = False) -> dict:
    settings = get_settings()
    with zipfile.ZipFile(archive) as zf:
        manifest = json.loads(zf.read("manifest.json"))
        if manifest.get("format_version") != FORMAT_VERSION:
            raise RuntimeError(f"Unsupported backup format {manifest.get('format_version')}")
        expected = "sqlite" if settings.is_sqlite else "postgresql"
        if manifest["database"] != expected:
            raise RuntimeError(f"Backup is for {manifest['database']}, but this instance uses {expected}")
        root = settings.storage_dir.resolve()
        if _has_existing_data(root) and not force:
            raise RuntimeError("Target instance is not empty (projects or stored files exist); "
                               "pass --force to replace it")
        # Validate every member path before extracting anything (zip-slip protection).
        members = [m for m in zf.namelist() if m.startswith("storage/")]
        for m in members:
            target = (root / m.removeprefix("storage/")).resolve()
            if not target.is_relative_to(root):
                raise RuntimeError(f"Unsafe path in archive: {m}")
        get_engine().dispose()
        if settings.is_sqlite:
            db = _sqlite_path()
            db.parent.mkdir(parents=True, exist_ok=True)
            for suffix in ("", "-wal", "-shm"):
                Path(f"{db}{suffix}").unlink(missing_ok=True)
            with zf.open("metadata.sqlite") as src, db.open("wb") as dst:
                shutil.copyfileobj(src, dst)
        else:
            with tempfile.TemporaryDirectory() as tmp:
                dump = Path(tmp) / "metadata.pgdump"
                dump.write_bytes(zf.read("metadata.pgdump"))
                # Use a pg_restore whose major version matches the server (see docs/DATABASE.md).
                _run_pg_tool("pg_restore", "--clean", "--if-exists", "--no-owner",
                             f"--dbname={make_url(settings.database_url).database}", str(dump))
        for area in STORAGE_AREAS:
            shutil.rmtree(root / area, ignore_errors=True)
        for m in members:
            if m.endswith("/"):
                continue
            target = root / m.removeprefix("storage/")
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(m) as src, target.open("wb") as dst:
                shutil.copyfileobj(src, dst)
    from app.cli import migrate

    migrate()  # upgrade older backups to the current schema
    return manifest
