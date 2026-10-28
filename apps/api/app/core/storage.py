"""Filesystem storage with path isolation.

All paths are generated server-side from validated IDs and verified to stay inside the storage
root. Metadata stores paths relative to the root so the storage directory can be relocated."""

import uuid
from pathlib import Path

from app.core.config import get_settings
from app.core.errors import AppError


def storage_root() -> Path:
    root = get_settings().storage_dir.resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def safe_path(*parts: str) -> Path:
    root = storage_root()
    candidate = root.joinpath(*parts).resolve()
    if not candidate.is_relative_to(root) or candidate == root:
        raise AppError("Invalid storage path", code="invalid_path")
    return candidate


def to_relative(path: Path) -> str:
    return path.resolve().relative_to(storage_root()).as_posix()


def from_relative(rel: str) -> Path:
    return safe_path(*rel.split("/"))


def _check_id(value: str) -> str:
    if not value or not all(c.isalnum() or c == "-" for c in value):
        raise AppError("Invalid identifier", code="invalid_path")
    return value


def new_upload_path(project_id: str, extension: str) -> Path:
    ext = extension.lower().lstrip(".")
    if not ext.isalnum() or len(ext) > 10:
        raise AppError("Invalid file extension", code="invalid_extension")
    path = safe_path("uploads", _check_id(project_id), f"{uuid.uuid4().hex}.{ext}")
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def dataset_version_path(project_id: str, dataset_id: str, version: int) -> Path:
    path = safe_path("datasets", _check_id(project_id), _check_id(dataset_id), f"v{int(version)}.parquet")
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def export_path(project_id: str, filename: str) -> Path:
    name = Path(filename).name
    if name != filename or name.startswith("."):
        raise AppError("Invalid export filename", code="invalid_path")
    path = safe_path("exports", _check_id(project_id), name)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path
