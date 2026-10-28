from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.analytics import query_engine, sql_guard
from app.analytics.chart_query import ChartQuery, compile_chart
from app.analytics.sql_builder import ColumnFilter
from app.core.errors import NotFound, ValidationFailed
from app.core.storage import from_relative
from app.models import Dashboard, DashboardFilter, DashboardWidget, Dataset, Project, User
from app.services import audit, datasets


def get_dashboard(db: Session, project_id: str, dashboard_id: str) -> Dashboard:
    d = db.get(Dashboard, dashboard_id)
    if d is None or d.project_id != project_id:
        raise NotFound("Dashboard not found")
    return d


def list_dashboards(db: Session, project_id: str) -> list[Dashboard]:
    return list(db.scalars(select(Dashboard).where(Dashboard.project_id == project_id)
                           .order_by(Dashboard.updated_at.desc())).all())


def create_dashboard(db: Session, project: Project, user: User, name: str, description: str | None) -> Dashboard:
    d = Dashboard(project_id=project.id, name=name.strip(), description=description, created_by=user.id)
    db.add(d)
    db.flush()
    audit.record(db, user_id=user.id, project_id=project.id, action="dashboard.created", resource_type="dashboard",
                 resource_id=d.id, summary=f"Created dashboard '{d.name}'")
    db.commit()
    return d


def _check_dataset(db: Session, project_id: str, dataset_id: str, cache: dict[str, Dataset]) -> Dataset:
    if dataset_id not in cache:
        cache[dataset_id] = datasets.get_dataset(db, project_id, dataset_id)
    return cache[dataset_id]


def save_definition(db: Session, user: User, dashboard: Dashboard, payload: dict[str, Any]) -> Dashboard:
    """Replace name, widgets and filters atomically. Widget configs are validated before saving;
    datasets must belong to the same project."""
    cache: dict[str, Dataset] = {}
    if payload.get("name"):
        dashboard.name = payload["name"].strip()
    if "description" in payload:
        dashboard.description = payload["description"]

    widgets: list[DashboardWidget] = []
    for i, w in enumerate(payload.get("widgets", [])):
        ds = _check_dataset(db, dashboard.project_id, w["dataset_id"], cache)
        query = ChartQuery.model_validate(w["query"])
        if ds.current_version is not None:  # validate column references against the schema
            types = datasets.column_types(datasets.get_version(db, ds))
            compile_chart(query, types, ds.table_name)
        widgets.append(DashboardWidget(
            id=w.get("id") or None, dataset_id=ds.id, chart_type=query.chart_type, title=w["title"],
            position=i, config={"query": query.model_dump(), "display": w.get("display", {})},
            layout=w["layout"],
        ))
    filters: list[DashboardFilter] = []
    for i, f in enumerate(payload.get("filters", [])):
        ds = _check_dataset(db, dashboard.project_id, f["dataset_id"], cache)
        if ds.current_version is not None:
            types = datasets.column_types(datasets.get_version(db, ds))
            if f["column"] not in types:
                raise ValidationFailed(f"Filter column '{f['column']}' does not exist in '{ds.name}'")
            if f["filter_type"] == "date_range" and types[f["column"]] not in ("date", "timestamp"):
                raise ValidationFailed(f"Date range filter requires a date column; '{f['column']}' is "
                                       f"{types[f['column']]}")
        filters.append(DashboardFilter(id=f.get("id") or None, dataset_id=ds.id, column=f["column"],
                                       filter_type=f["filter_type"], label=f["label"], position=i,
                                       default_value=f.get("default_value")))

    # Replace children: clear first so re-used ids don't collide within the unit of work.
    dashboard.widgets.clear()
    dashboard.filters.clear()
    db.flush()
    dashboard.widgets.extend(widgets)
    dashboard.filters.extend(filters)
    dashboard.updated_at = datetime.now(UTC)
    audit.record(db, user_id=user.id, project_id=dashboard.project_id, action="dashboard.saved",
                 resource_type="dashboard", resource_id=dashboard.id,
                 summary=f"Saved dashboard '{dashboard.name}' ({len(widgets)} widgets)")
    db.commit()
    db.refresh(dashboard)
    return dashboard


def delete_dashboard(db: Session, user: User, dashboard: Dashboard) -> None:
    pid, did, name = dashboard.project_id, dashboard.id, dashboard.name
    db.delete(dashboard)
    audit.record(db, user_id=user.id, project_id=pid, action="dashboard.deleted", resource_type="dashboard",
                 resource_id=did, summary=f"Deleted dashboard '{name}'")
    db.commit()


def duplicate_dashboard(db: Session, user: User, dashboard: Dashboard) -> Dashboard:
    copy = Dashboard(project_id=dashboard.project_id, name=f"{dashboard.name} (copy)"[:120],
                     description=dashboard.description, created_by=user.id)
    copy.widgets = [DashboardWidget(dataset_id=w.dataset_id, chart_type=w.chart_type, title=w.title,
                                    position=w.position, config=dict(w.config), layout=dict(w.layout))
                    for w in dashboard.widgets]
    copy.filters = [DashboardFilter(dataset_id=f.dataset_id, column=f.column, filter_type=f.filter_type,
                                    label=f.label, position=f.position, default_value=f.default_value)
                    for f in dashboard.filters]
    db.add(copy)
    db.commit()
    return copy


def chart_data(db: Session, project_id: str, dataset_id: str, query: ChartQuery,
               dashboard_filters: list[dict[str, Any]]) -> dict[str, Any]:
    """Execute a chart query. Dashboard filters apply only when they target this widget's dataset."""
    ds = datasets.get_dataset(db, project_id, dataset_id)
    version = datasets.get_version(db, ds)
    types = datasets.column_types(version)
    extra = [ColumnFilter.model_validate(f["filter"]) for f in dashboard_filters
             if f.get("dataset_id") == ds.id and f["filter"].get("column") in types]
    sql, cap = compile_chart(query, types, ds.table_name, extra)
    tables = {ds.table_name: from_relative(version.storage_path)}
    validated = sql_guard.validate_query(sql, set(tables))
    result = query_engine.execute(validated.sql, tables, max_rows=cap)
    return {"columns": result.columns, "rows": result.rows, "truncated": result.truncated,
            "duration_ms": result.duration_ms, "sql": validated.sql, "applied_filters": len(extra),
            "dataset": {"id": ds.id, "name": ds.name, "table_name": ds.table_name, "version": version.version}}


def distinct_values(db: Session, project_id: str, dataset_id: str, column: str, search: str | None,
                    limit: int = 200) -> list[Any]:
    ds = datasets.get_dataset(db, project_id, dataset_id)
    version = datasets.get_version(db, ds)
    types = datasets.column_types(version)
    from app.analytics.sql_builder import ident, resolve_column, string_literal

    resolve_column(types, column)
    where = ""
    if search:
        escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        where = f" WHERE CAST({ident(column)} AS VARCHAR) ILIKE {string_literal('%' + escaped + '%')} ESCAPE '\\'"
    sql = (f"SELECT {ident(column)} AS v, count(*) AS n FROM t{where} GROUP BY 1 "
           f"ORDER BY n DESC, 1 NULLS LAST LIMIT {int(limit)}")
    tables = {"t": from_relative(version.storage_path)}
    result = query_engine.execute(sql_guard.validate_query(sql, {"t"}).sql, tables, max_rows=limit)
    return [{"value": r[0], "count": r[1]} for r in result.rows]
