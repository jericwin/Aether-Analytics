from typing import Annotated, Any

from fastapi import APIRouter, Query, Response
from sqlalchemy import func, select

from app.core.errors import ValidationFailed
from app.models import QueryHistory, SavedQuery
from app.schemas import Page, QueryHistoryOut, QueryIn, SavedQueryIn, SavedQueryOut, SavedQueryPatch
from app.security.deps import Auth, DbSession, ProjectEditor, ProjectViewer
from app.services import audit
from app.services import queries as svc

router = APIRouter(prefix="/projects/{project_id}", tags=["sql"])


@router.get("/schema")
def schema(access: ProjectViewer, db: DbSession) -> list[dict[str, Any]]:
    return svc.schema_catalog(db, access.project.id)


@router.post("/queries/execute")
def execute(body: QueryIn, access: ProjectViewer, db: DbSession) -> dict[str, Any]:
    return svc.run_query(db, access.project, access.user, body.sql, max_rows=body.max_rows,
                         client_query_id=body.client_query_id)


@router.post("/queries/{client_query_id}/cancel")
def cancel(client_query_id: str, access: ProjectViewer) -> dict[str, bool]:
    if not 8 <= len(client_query_id) <= 64:
        raise ValidationFailed("Invalid query id")
    return {"cancelled": svc.cancel_query(access.user, client_query_id)}


@router.post("/queries/export")
def export(body: QueryIn, access: ProjectViewer, db: DbSession) -> Response:
    data, truncated = svc.export_query_csv(db, access.project, body.sql)
    return Response(content=data, media_type="text/csv", headers={
        "Content-Disposition": 'attachment; filename="query_result.csv"',
        "X-Aether-Truncated": "true" if truncated else "false"})


@router.get("/query-history", response_model=Page[QueryHistoryOut])
def history(access: ProjectViewer, auth: Auth, db: DbSession, limit: Annotated[int, Query(ge=1, le=200)] = 50,
            offset: Annotated[int, Query(ge=0)] = 0) -> Page[QueryHistoryOut]:
    base = select(QueryHistory).where(QueryHistory.project_id == access.project.id,
                                      QueryHistory.user_id == auth.user.id)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    items = db.scalars(base.order_by(QueryHistory.created_at.desc()).limit(limit).offset(offset)).all()
    return Page(items=[QueryHistoryOut.model_validate(i) for i in items], total=total, limit=limit, offset=offset)


@router.get("/saved-queries", response_model=list[SavedQueryOut])
def list_saved(access: ProjectViewer, db: DbSession) -> list[SavedQuery]:
    return list(db.scalars(select(SavedQuery).where(SavedQuery.project_id == access.project.id)
                           .order_by(SavedQuery.updated_at.desc())).all())


@router.post("/saved-queries", response_model=SavedQueryOut, status_code=201)
def create_saved(body: SavedQueryIn, access: ProjectEditor, db: DbSession) -> SavedQuery:
    return svc.save_query(db, access.project, access.user, body.name, body.sql, body.description)


@router.get("/saved-queries/{query_id}", response_model=SavedQueryOut)
def get_saved(query_id: str, access: ProjectViewer, db: DbSession) -> SavedQuery:
    return svc.get_saved(db, access.project.id, query_id)


@router.patch("/saved-queries/{query_id}", response_model=SavedQueryOut)
def update_saved(query_id: str, body: SavedQueryPatch, access: ProjectEditor, db: DbSession) -> SavedQuery:
    q = svc.get_saved(db, access.project.id, query_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is not None:
            setattr(q, k, v)
    audit.record(db, user_id=access.user.id, project_id=access.project.id, action="query.updated",
                 resource_type="saved_query", resource_id=q.id, summary=f"Updated query '{q.name}'")
    db.commit()
    return q


@router.delete("/saved-queries/{query_id}", status_code=204)
def delete_saved(query_id: str, access: ProjectEditor, db: DbSession) -> Response:
    q = svc.get_saved(db, access.project.id, query_id)
    audit.record(db, user_id=access.user.id, project_id=access.project.id, action="query.deleted",
                 resource_type="saved_query", resource_id=q.id, summary=f"Deleted query '{q.name}'")
    db.delete(q)
    db.commit()
    return Response(status_code=204)
