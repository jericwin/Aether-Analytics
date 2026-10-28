from typing import Any

from fastapi import APIRouter, File, Response, UploadFile
from sqlalchemy import select

from app.models import Dataset, DatasetVersion, DataSource
from app.schemas import (
    DatasetDetail,
    DatasetOut,
    DatasetPatch,
    ExportIn,
    ImportIn,
    ImportStarted,
    JobOut,
    NewVersionIn,
    PreviewIn,
    RowsIn,
    UploadOut,
    VersionDetail,
    VersionOut,
)
from app.security.deps import DbSession, ProjectEditor, ProjectViewer
from app.services import datasets as svc
from app.workers import queue

router = APIRouter(prefix="/projects/{project_id}", tags=["datasets"])


def _dataset_out(ds: Dataset, v: DatasetVersion | None, src: DataSource | None, cls: type = DatasetOut) -> Any:
    out = cls.model_validate(ds)
    if v is not None:
        out.row_count, out.column_count, out.size_bytes = v.row_count, v.column_count, v.size_bytes
        out.quality_score = (v.profile or {}).get("quality_score")
    if src is not None:
        out.source_filename, out.source_format = src.original_filename, src.file_format
    return out


# --------------------------------------------------------------------------- uploads
@router.post("/uploads", response_model=UploadOut, status_code=201)
def upload(access: ProjectEditor, db: DbSession, file: UploadFile = File(...)) -> DataSource:
    return svc.save_upload(db, access.project, access.user, file.filename or "upload", file.file)


@router.post("/uploads/{source_id}/preview")
def preview(source_id: str, body: PreviewIn, access: ProjectEditor, db: DbSession) -> dict[str, Any]:
    return svc.preview_source(svc.get_source(db, access.project.id, source_id), body.options)


# --------------------------------------------------------------------------- datasets
@router.get("/datasets", response_model=list[DatasetOut])
def list_datasets(access: ProjectViewer, db: DbSession) -> list[DatasetOut]:
    rows = db.execute(
        select(Dataset, DatasetVersion, DataSource)
        .outerjoin(DatasetVersion, (DatasetVersion.dataset_id == Dataset.id)
                   & (DatasetVersion.version == Dataset.current_version))
        .outerjoin(DataSource, DataSource.id == Dataset.source_id)
        .where(Dataset.project_id == access.project.id)
        .order_by(Dataset.updated_at.desc())
    ).all()
    return [_dataset_out(ds, v, s) for ds, v, s in rows]


@router.post("/datasets", response_model=ImportStarted, status_code=202)
def import_dataset(body: ImportIn, access: ProjectEditor, db: DbSession) -> ImportStarted:
    source = svc.get_source(db, access.project.id, body.source_id)
    ds, job = svc.start_import(db, access.project, access.user, source, body.name, body.table_name,
                               body.description, body.options)
    return ImportStarted(dataset=DatasetOut.model_validate(ds), job=JobOut.model_validate(job))


@router.get("/datasets/{dataset_id}", response_model=DatasetDetail)
def get_dataset(dataset_id: str, access: ProjectViewer, db: DbSession) -> DatasetDetail:
    ds = svc.get_dataset(db, access.project.id, dataset_id)
    version = svc.get_version(db, ds) if ds.current_version else None
    src = db.get(DataSource, ds.source_id) if ds.source_id else None
    out = _dataset_out(ds, version, src, DatasetDetail)
    out.version = VersionDetail.model_validate(version) if version else None
    out.versions = [VersionOut.model_validate(v) for v in reversed(ds.versions)]
    return out


@router.patch("/datasets/{dataset_id}", response_model=DatasetOut)
def update_dataset(dataset_id: str, body: DatasetPatch, access: ProjectEditor, db: DbSession) -> DatasetOut:
    ds = svc.get_dataset(db, access.project.id, dataset_id)
    return DatasetOut.model_validate(svc.rename_dataset(db, access.user, ds, body.name, body.description))


@router.delete("/datasets/{dataset_id}", status_code=204)
def delete_dataset(dataset_id: str, access: ProjectEditor, db: DbSession) -> Response:
    svc.delete_dataset(db, access.user, svc.get_dataset(db, access.project.id, dataset_id))
    return Response(status_code=204)


@router.get("/datasets/{dataset_id}/dependents")
def dataset_dependents(dataset_id: str, access: ProjectViewer, db: DbSession) -> list[dict[str, str]]:
    return svc.dependents(db, svc.get_dataset(db, access.project.id, dataset_id))


@router.post("/datasets/{dataset_id}/versions", response_model=JobOut, status_code=202)
def new_version(dataset_id: str, body: NewVersionIn, access: ProjectEditor, db: DbSession) -> Any:
    ds = svc.get_dataset(db, access.project.id, dataset_id)
    source = svc.get_source(db, access.project.id, body.source_id)
    return svc.start_reimport(db, access.project, access.user, ds, source, body.options)


@router.get("/datasets/{dataset_id}/versions/{version}", response_model=VersionDetail)
def get_version(dataset_id: str, version: int, access: ProjectViewer, db: DbSession) -> DatasetVersion:
    return svc.get_version(db, svc.get_dataset(db, access.project.id, dataset_id), version)


@router.get("/datasets/{dataset_id}/profile")
def get_profile(dataset_id: str, access: ProjectViewer, db: DbSession, version: int | None = None) -> dict[str, Any]:
    v = svc.get_version(db, svc.get_dataset(db, access.project.id, dataset_id), version)
    return {"version": v.version, "profiled_at": v.profiled_at, "profile": v.profile}


@router.post("/datasets/{dataset_id}/profile", response_model=JobOut, status_code=202)
def refresh_profile(dataset_id: str, access: ProjectEditor, db: DbSession, version: int | None = None) -> Any:
    v = svc.get_version(db, svc.get_dataset(db, access.project.id, dataset_id), version)
    return queue.enqueue(db, job_type="dataset_profile", payload={"version_id": v.id, "dataset_id": dataset_id},
                         project_id=access.project.id, user_id=access.user.id)


@router.post("/datasets/{dataset_id}/rows")
def browse_rows(dataset_id: str, body: RowsIn, access: ProjectViewer, db: DbSession) -> dict[str, Any]:
    ds = svc.get_dataset(db, access.project.id, dataset_id)
    v = svc.get_version(db, ds, body.version)
    return svc.browse_rows(db, ds, v, offset=body.offset, limit=body.limit, sort=list(body.sort),
                           filters=body.filters, columns=body.columns)


@router.post("/datasets/{dataset_id}/export")
def export_rows(dataset_id: str, body: ExportIn, access: ProjectViewer, db: DbSession) -> Response:
    ds = svc.get_dataset(db, access.project.id, dataset_id)
    v = svc.get_version(db, ds, body.version)
    data, truncated = svc.export_csv(db, ds, v, body.filters, body.columns)
    headers = {"Content-Disposition": f'attachment; filename="{ds.table_name}_v{v.version}.csv"',
               "X-Aether-Truncated": "true" if truncated else "false"}
    return Response(content=data, media_type="text/csv", headers=headers)
