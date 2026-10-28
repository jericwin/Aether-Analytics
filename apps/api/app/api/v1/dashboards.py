from typing import Annotated, Any

from fastapi import APIRouter, Query, Response

from app.schemas import ChartDataIn, DashboardDetail, DashboardIn, DashboardOut, DashboardSave
from app.security.deps import DbSession, ProjectEditor, ProjectViewer
from app.services import dashboards as svc

router = APIRouter(prefix="/projects/{project_id}", tags=["dashboards"])


def _summary(d: Any) -> DashboardOut:
    out = DashboardOut.model_validate(d)
    out.widget_count = len(d.widgets)
    return out


@router.get("/dashboards", response_model=list[DashboardOut])
def list_dashboards(access: ProjectViewer, db: DbSession) -> list[DashboardOut]:
    return [_summary(d) for d in svc.list_dashboards(db, access.project.id)]


@router.post("/dashboards", response_model=DashboardDetail, status_code=201)
def create_dashboard(body: DashboardIn, access: ProjectEditor, db: DbSession) -> Any:
    return svc.create_dashboard(db, access.project, access.user, body.name, body.description)


@router.get("/dashboards/{dashboard_id}", response_model=DashboardDetail)
def get_dashboard(dashboard_id: str, access: ProjectViewer, db: DbSession) -> Any:
    return svc.get_dashboard(db, access.project.id, dashboard_id)


@router.put("/dashboards/{dashboard_id}", response_model=DashboardDetail)
def save_dashboard(dashboard_id: str, body: DashboardSave, access: ProjectEditor, db: DbSession) -> Any:
    d = svc.get_dashboard(db, access.project.id, dashboard_id)
    return svc.save_definition(db, access.user, d, body.model_dump(mode="json"))


@router.post("/dashboards/{dashboard_id}/duplicate", response_model=DashboardDetail, status_code=201)
def duplicate_dashboard(dashboard_id: str, access: ProjectEditor, db: DbSession) -> Any:
    return svc.duplicate_dashboard(db, access.user, svc.get_dashboard(db, access.project.id, dashboard_id))


@router.delete("/dashboards/{dashboard_id}", status_code=204)
def delete_dashboard(dashboard_id: str, access: ProjectEditor, db: DbSession) -> Response:
    svc.delete_dashboard(db, access.user, svc.get_dashboard(db, access.project.id, dashboard_id))
    return Response(status_code=204)


@router.post("/charts/data")
def chart_data(body: ChartDataIn, access: ProjectViewer, db: DbSession) -> dict[str, Any]:
    return svc.chart_data(db, access.project.id, body.dataset_id, body.query,
                          [f.model_dump(mode="json") for f in body.dashboard_filters])


@router.get("/datasets/{dataset_id}/columns/{column}/values")
def column_values(dataset_id: str, column: str, access: ProjectViewer, db: DbSession,
                  search: Annotated[str | None, Query(max_length=200)] = None) -> list[Any]:
    return svc.distinct_values(db, access.project.id, dataset_id, column, search)
