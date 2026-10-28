from datetime import UTC, datetime, timedelta

from app.db.session import get_sessionmaker
from app.models import Job
from app.workers import queue


def _widget(ds_id: str, **query):
    return {"title": query.pop("title", "Chart"), "dataset_id": ds_id, "query": query,
            "layout": {"x": 0, "y": 0, "w": 6, "h": 4}, "display": {"number_format": "compact"}}


def test_dashboard_persistence_and_chart_data(sales_dataset):
    api, pid, ds = sales_dataset
    d = api.post(f"/api/v1/projects/{pid}/dashboards", json={"name": "Sales overview"}).json()
    body = {
        "name": "Sales overview",
        "widgets": [
            _widget(ds["id"], chart_type="kpi", title="Units",
                    measures=[{"column": "quantity", "agg": "sum", "label": "units"}]),
            _widget(ds["id"], chart_type="bar", dimension="region",
                    measures=[{"column": "quantity", "agg": "sum"}]),
            _widget(ds["id"], chart_type="line", dimension="order_date", date_grain="month",
                    measures=[{"agg": "count"}]),
        ],
        "filters": [{"dataset_id": ds["id"], "column": "region", "filter_type": "category", "label": "Region"},
                    {"dataset_id": ds["id"], "column": "order_date", "filter_type": "date_range", "label": "Date"}],
    }
    saved = api.put(f"/api/v1/projects/{pid}/dashboards/{d['id']}", json=body)
    assert saved.status_code == 200, saved.text
    reopened = api.get(f"/api/v1/projects/{pid}/dashboards/{d['id']}").json()
    assert [w["chart_type"] for w in reopened["widgets"]] == ["kpi", "bar", "line"]
    assert reopened["widgets"][0]["layout"] == {"x": 0, "y": 0, "w": 6, "h": 4}
    assert reopened["widgets"][0]["config"]["display"] == {"number_format": "compact"}
    assert [f["column"] for f in reopened["filters"]] == ["region", "order_date"]

    def data(widget, filters=()):
        r = api.post(f"/api/v1/projects/{pid}/charts/data",
                     json={"dataset_id": ds["id"], "query": widget["config"]["query"],
                           "dashboard_filters": list(filters)})
        assert r.status_code == 200, r.text
        return r.json()

    kpi, bar, line = reopened["widgets"]
    assert data(kpi)["rows"] == [[18]]  # quantity sum, null excluded
    assert data(bar)["rows"][:2] == [["East", 7], ["North", 6]]
    assert data(line)["rows"] == [["2024-01-01", 2], ["2024-02-01", 2], ["2024-03-01", 2], ["2024-04-01", 2]]

    # Dashboard filters (incl. cross-filter on a category) change the actual results.
    north = {"dataset_id": ds["id"], "filter": {"column": "region", "op": "in", "values": ["North"]}}
    q1 = {"dataset_id": ds["id"], "filter": {"column": "order_date", "op": "between",
                                            "values": ["2024-01-01", "2024-03-31"]}}
    assert data(kpi, [north])["rows"] == [[6]]
    assert data(kpi, [north, q1])["rows"] == [[6]]
    assert data(line, [q1])["rows"] == [["2024-01-01", 2], ["2024-02-01", 2], ["2024-03-01", 2]]
    other_ds = {"dataset_id": "unrelated", "filter": {"column": "region", "op": "eq", "value": "x"}}
    assert data(kpi, [other_ds])["applied_filters"] == 0


def test_chart_validation(sales_dataset):
    api, pid, ds = sales_dataset

    def post(query):
        return api.post(f"/api/v1/projects/{pid}/charts/data", json={"dataset_id": ds["id"], "query": query})

    assert post({"chart_type": "bar"}).status_code == 422  # missing dimension
    r = post({"chart_type": "bar", "dimension": "region", "measures": [{"column": "region", "agg": "sum"}]})
    assert r.status_code == 422 and "Cannot apply 'sum'" in r.json()["error"]["message"]
    r = post({"chart_type": "line", "dimension": "region", "date_grain": "month"})
    assert r.status_code == 422
    r = post({"chart_type": "bar", "dimension": 'region" ; DROP', "measures": [{"agg": "count"}]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "unknown_column"


def test_other_chart_types(sales_dataset):
    api, pid, ds = sales_dataset

    def rows(query):
        r = api.post(f"/api/v1/projects/{pid}/charts/data", json={"dataset_id": ds["id"], "query": query})
        assert r.status_code == 200, r.text
        return r.json()["rows"]

    stacked = rows({"chart_type": "stacked_bar", "dimension": "region", "series": "product",
                    "measures": [{"agg": "count"}]})
    assert ["North", "Widget", 1] in stacked and sum(r[2] for r in stacked) == 8
    hist = rows({"chart_type": "histogram", "y": "unit_price", "bins": 4})
    assert sum(r[3] for r in hist) == 8
    box = rows({"chart_type": "boxplot", "y": "unit_price", "dimension": "region"})
    assert {r[0] for r in box} == {"North", "South", "East", "West"}
    scatter = rows({"chart_type": "scatter", "x": "quantity", "y": "unit_price"})
    assert len(scatter) == 7  # null quantity excluded
    pie = rows({"chart_type": "pie", "dimension": "product", "measures": [{"agg": "count"}], "limit": 2})
    assert pie == [["Widget", 4], ["Gadget", 3]]


def test_dataset_in_use_cannot_be_deleted_but_project_can(sales_dataset):
    api, pid, ds = sales_dataset
    d = api.post(f"/api/v1/projects/{pid}/dashboards", json={"name": "D"}).json()
    api.put(f"/api/v1/projects/{pid}/dashboards/{d['id']}", json={
        "name": "D", "widgets": [_widget(ds["id"], chart_type="kpi", measures=[{"agg": "count"}])]})
    r = api.delete(f"/api/v1/projects/{pid}/datasets/{ds['id']}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "dataset_in_use"
    assert r.json()["error"]["details"][0]["dashboard"] == "D"
    dup = api.post(f"/api/v1/projects/{pid}/dashboards/{d['id']}/duplicate").json()
    assert dup["name"] == "D (copy)" and len(dup["widgets"]) == 1
    assert api.delete(f"/api/v1/projects/{pid}").status_code == 204


def test_column_values_for_filters(sales_dataset):
    api, pid, ds = sales_dataset
    vals = api.get(f"/api/v1/projects/{pid}/datasets/{ds['id']}/columns/region/values").json()
    assert vals[0] == {"value": "North", "count": 3}
    vals = api.get(f"/api/v1/projects/{pid}/datasets/{ds['id']}/columns/region/values",
                   params={"search": "st"}).json()
    assert [v["value"] for v in vals] == ["East", "West"]


# --------------------------------------------------------------------------- jobs
def test_job_queue_claim_cancel_and_recovery(api):
    pid = api.create_project()["id"]
    sm = get_sessionmaker()
    with sm() as db:
        pending = Job(job_type="dataset_profile", payload={"version_id": "missing"}, project_id=pid)
        stale = Job(job_type="dataset_profile", payload={"version_id": "missing"}, project_id=pid,
                    status="running", attempts=1, heartbeat_at=datetime.now(UTC) - timedelta(hours=1))
        db.add_all([pending, stale])
        db.commit()
        pending_id, stale_id = pending.id, stale.id

    # Cancel a pending job via the API.
    r = api.post(f"/api/v1/jobs/{pending_id}/cancel")
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert queue.claim_next("w1") != pending_id

    # A job whose worker stopped heart-beating is returned to the queue and completes.
    assert queue.recover_stale() >= 1
    with sm() as db:
        assert db.get(Job, stale_id).status == "pending"
    claimed = queue.claim_next("w1")
    assert claimed is not None
    queue.run_job(claimed, "w1")
    job = api.get(f"/api/v1/jobs/{stale_id}").json()
    assert job["status"] == "succeeded" and job["result"] == {"skipped": "version deleted"}
    listing = api.get("/api/v1/jobs", params={"project_id": pid}).json()
    assert {j["id"] for j in listing["items"]} >= {pending_id, stale_id}


def test_jobs_are_not_visible_to_non_members(sales_dataset, other_api):
    api, pid, _ = sales_dataset
    job_id = api.get("/api/v1/jobs", params={"project_id": pid}).json()["items"][0]["id"]
    assert other_api.get(f"/api/v1/jobs/{job_id}").status_code == 404
    assert other_api.get("/api/v1/jobs", params={"project_id": pid}).status_code == 404
    assert all(j["project_id"] != pid for j in other_api.get("/api/v1/jobs").json()["items"])


# --------------------------------------------------------------------------- demo data
def test_demo_generator_is_deterministic():
    from app.demo import generate

    a, b = generate(seed=7, n_customers=200, base_orders=3), generate(seed=7, n_customers=200, base_orders=3)
    assert all(a[k].equals(b[k]) for k in a)
    c = generate(seed=8, n_customers=200, base_orders=3)
    assert not a["orders"].equals(c["orders"])
    orders, items = a["orders"], a["order_items"]
    assert set(items["order_id"].unique()) <= set(orders["order_id"])
    assert orders["shipping_cost"].null_count() > 0  # deliberate quality issues


def test_demo_project_end_to_end(api):
    r = api.post("/api/v1/projects/demo")
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    assert r.json()["is_demo"] is True
    datasets = api.get(f"/api/v1/projects/{pid}/datasets").json()
    assert {d["table_name"] for d in datasets} == {"orders", "order_items", "products", "customers",
                                                   "sales_regions", "inventory_snapshots"}
    assert all(d["status"] == "ready" for d in datasets)
    dash = api.get(f"/api/v1/projects/{pid}/dashboards").json()[0]
    detail = api.get(f"/api/v1/projects/{pid}/dashboards/{dash['id']}").json()
    for w in detail["widgets"]:
        res = api.post(f"/api/v1/projects/{pid}/charts/data", json={"dataset_id": w["dataset_id"],
                                                                     "query": w["config"]["query"]})
        assert res.status_code == 200, (w["title"], res.text)
        assert res.json()["rows"], w["title"]
    q = api.post(f"/api/v1/projects/{pid}/queries/execute", json={"sql": """
        SELECT p.category, round(sum(i.line_revenue), 2) AS revenue
        FROM order_items i JOIN products p USING (product_id) GROUP BY 1 ORDER BY 2 DESC"""})
    assert q.status_code == 200 and len(q.json()["rows"]) == 5
