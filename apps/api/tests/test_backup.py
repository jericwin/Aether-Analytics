"""Backup/restore round trip: data written before the backup is fully recovered after a wipe."""

import pytest

from app.backup import create_backup, restore_backup
from app.core.config import get_settings
from app.db.session import get_engine


def test_backup_restore_round_trip(sales_dataset, tmp_path):
    api, pid, ds = sales_dataset
    q = api.post(f"/api/v1/projects/{pid}/saved-queries", json={"name": "keep me", "sql": "SELECT 1"}).json()
    archive = create_backup(tmp_path / "aether-backup")
    assert archive.exists() and archive.suffix == ".zip"

    # Simulate data loss: delete the project (DB rows + Parquet files).
    assert api.delete(f"/api/v1/projects/{pid}").status_code == 204
    assert api.get(f"/api/v1/projects/{pid}").status_code == 404

    with pytest.raises(RuntimeError, match="not empty"):
        restore_backup(archive)
    manifest = restore_backup(archive, force=True)
    assert manifest["alembic_revision"] == "0001"

    get_engine().dispose()
    assert api.get(f"/api/v1/projects/{pid}").status_code == 200
    assert api.get(f"/api/v1/projects/{pid}/saved-queries/{q['id']}").json()["name"] == "keep me"
    rows = api.post(f"/api/v1/projects/{pid}/datasets/{ds['id']}/rows", json={}).json()
    assert rows["total"] == 8  # Parquet data restored, not just metadata


def test_restore_rejects_zip_slip(tmp_path):
    import json
    import zipfile

    evil = tmp_path / "evil.zip"
    with zipfile.ZipFile(evil, "w") as zf:
        backend = "sqlite" if get_settings().is_sqlite else "postgresql"
        zf.writestr("manifest.json", json.dumps({"format_version": 1, "database": backend, "created_at": "x"}))
        zf.writestr("metadata.sqlite", b"")
        zf.writestr("storage/../../escape.txt", b"pwned")
    with pytest.raises(RuntimeError, match="Unsafe path"):
        restore_backup(evil, force=True)
    assert not (get_settings().storage_dir.parent / "escape.txt").exists()


def test_pg_tool_errors_never_contain_the_password(monkeypatch):
    """pg_dump/pg_restore get the password via PGPASSWORD, so failures can't echo it."""
    import subprocess

    from app.backup import _run_pg_tool
    from app.core.config import get_settings

    seen: dict = {}

    def fake_run(argv, env, capture_output, text):
        seen["argv"], seen["env"] = argv, env
        return subprocess.CompletedProcess(argv, 1, "", "pg_restore: error: boom\n")

    monkeypatch.setattr(get_settings(), "database_url", "postgresql+psycopg://alice:s3cr3t-pw@db:5433/aether")
    monkeypatch.setattr(subprocess, "run", fake_run)
    with pytest.raises(RuntimeError) as exc:
        _run_pg_tool("pg_restore", "--dbname=aether", "dump")
    assert "s3cr3t-pw" not in str(exc.value) and "boom" in str(exc.value)
    assert not any("s3cr3t-pw" in a for a in seen["argv"])
    assert seen["env"]["PGPASSWORD"] == "s3cr3t-pw"
    assert seen["argv"][1:7] == ["-h", "db", "-p", "5433", "-U", "alice"]
