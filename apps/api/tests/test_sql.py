"""SQL workbench: the guard, the engine lockdown, and the end-to-end API."""

import threading
import time
import uuid

import pytest

from app.analytics import query_engine, sql_guard
from app.analytics.sql_guard import SqlRejected
from tests.conftest import Api

ALLOWED = {"orders", "customers"}

MALICIOUS = [
    "DROP TABLE orders",
    "DELETE FROM orders",
    "INSERT INTO orders VALUES (1)",
    "UPDATE orders SET x = 1",
    "CREATE TABLE x AS SELECT 1",
    "COPY orders TO 'C:/temp/out.csv'",
    "ATTACH 'other.db'",
    "INSTALL httpfs",
    "LOAD httpfs",
    "PRAGMA database_list",
    "SET enable_external_access = true",
    "SELECT 1; DROP TABLE orders",
    "SELECT * FROM read_csv('C:/Windows/win.ini')",
    "SELECT * FROM read_parquet('../../secret.parquet')",
    "SELECT * FROM 'C:/data/file.parquet'",
    "SELECT * FROM main.orders",
    "SELECT * FROM other_project_table",
    "SELECT * FROM duckdb_settings()",
    "SELECT current_setting('allowed_paths')",
    "SELECT getenv('PATH')",
    "SELECT * FROM glob('*')",
    "SELECT * FROM query('select 1')",
    "WITH x AS (SELECT * FROM read_text('/etc/passwd')) SELECT * FROM x",
    "SELECT * FROM orders WHERE id IN (SELECT id FROM sqlite_scan('x.db', 't'))",
    "SUMMARIZE orders",
    "DESCRIBE orders",
    "EXPORT DATABASE 'x'",
    "",
    "SELEC broken syntax",
]


@pytest.mark.parametrize("sql", MALICIOUS)
def test_guard_rejects_malicious_and_malformed(sql):
    with pytest.raises(SqlRejected):
        sql_guard.validate_query(sql, ALLOWED)


@pytest.mark.parametrize("sql", [
    "SELECT * FROM orders",
    "select count(*) from ORDERS",
    "WITH t AS (SELECT 1 AS a) SELECT * FROM t JOIN orders ON true",
    "SELECT region, sum(amount) OVER (PARTITION BY region ORDER BY day) FROM orders",
    "SELECT * FROM orders UNION ALL SELECT * FROM orders",
    "FROM orders SELECT region",
])
def test_guard_allows_analytical_queries(sql):
    v = sql_guard.validate_query(sql, ALLOWED)
    assert v.tables <= ALLOWED


def test_engine_lockdown_blocks_file_access_even_without_guard(tmp_path):
    import polars as pl

    p = tmp_path / "d.parquet"
    pl.DataFrame({"a": [1, 2]}).write_parquet(p)
    secret = tmp_path / "secret.csv"
    secret.write_text("x\n1\n")
    tables = {"d": p}
    assert query_engine.execute("SELECT sum(a) FROM d", tables).rows == [[3]]
    for raw in [f"SELECT * FROM read_csv('{secret.as_posix()}')",
                "SELECT 1 FROM (SELECT 1) t WHERE (SELECT count(*) FROM glob('*')) > 0"]:
        with pytest.raises(query_engine.QueryFailed):
            query_engine.execute(raw, tables)


def test_engine_timeout(tmp_path):
    import polars as pl

    p = tmp_path / "d.parquet"
    pl.DataFrame({"a": list(range(3000))}).write_parquet(p)
    heavy = "SELECT sum(hash(a.a * 7 + b.a * 13 + c.a)) FROM d a, d b, d c"
    with pytest.raises(query_engine.QueryTimeout):
        query_engine.execute(heavy, {"d": p}, timeout=0.5)


def test_execute_aggregate_join_window(sales_dataset):
    api, pid, _ = sales_dataset
    api.import_file(pid, "regions.csv", b"region,manager\nNorth,Ana\nSouth,Ben\nEast,Cy\nWest,Di\n", name="Regions")
    sql = """
        WITH rev AS (
            SELECT region, sum(quantity * unit_price) AS revenue FROM sales GROUP BY region
        )
        SELECT r.region, m.manager, round(r.revenue, 2) AS revenue,
               rank() OVER (ORDER BY r.revenue DESC) AS rnk
        FROM rev r JOIN regions m USING (region) ORDER BY rnk
    """
    r = api.post(f"/api/v1/projects/{pid}/queries/execute", json={"sql": sql})
    assert r.status_code == 200, r.text
    body = r.json()
    assert [c["name"] for c in body["columns"]] == ["region", "manager", "revenue", "rnk"]
    assert body["rows"][0] == ["North", "Ana", 196.49, 1]  # 2*10 + 3*25.5 + 1*99.99
    assert body["tables"] == ["regions", "sales"]


def test_result_bounding_and_history(sales_dataset):
    api, pid, _ = sales_dataset
    r = api.post(f"/api/v1/projects/{pid}/queries/execute", json={"sql": "SELECT * FROM sales", "max_rows": 3}).json()
    assert r["row_count"] == 3 and r["truncated"] is True
    bad = api.post(f"/api/v1/projects/{pid}/queries/execute", json={"sql": "DROP TABLE sales"})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "sql_rejected"
    err = api.post(f"/api/v1/projects/{pid}/queries/execute", json={"sql": "SELECT missing_col FROM sales"})
    assert err.status_code == 400 and err.json()["error"]["code"] == "query_failed"
    hist = api.get(f"/api/v1/projects/{pid}/query-history").json()["items"]
    assert [h["status"] for h in hist[:3]] == ["failed", "rejected", "succeeded"]


def test_saved_queries_and_export(sales_dataset):
    api, pid, _ = sales_dataset
    sql = "SELECT region, count(*) AS n FROM sales GROUP BY region ORDER BY region"
    saved = api.post(f"/api/v1/projects/{pid}/saved-queries", json={"name": "By region", "sql": sql}).json()
    got = api.get(f"/api/v1/projects/{pid}/saved-queries/{saved['id']}").json()
    assert got["sql"] == sql
    api.patch(f"/api/v1/projects/{pid}/saved-queries/{saved['id']}", json={"name": "Orders by region"})
    assert api.get(f"/api/v1/projects/{pid}/saved-queries").json()[0]["name"] == "Orders by region"
    csv = api.post(f"/api/v1/projects/{pid}/queries/export", json={"sql": sql}).text.strip().splitlines()
    assert csv == ["region,n", "East,2", "North,3", "South,2", "West,1"]
    assert api.delete(f"/api/v1/projects/{pid}/saved-queries/{saved['id']}").status_code == 204


def test_query_scope_is_limited_to_project(sales_dataset, other_api: Api):
    api, pid, _ = sales_dataset
    other_pid = other_api.create_project("Mine")["id"]
    r = other_api.post(f"/api/v1/projects/{other_pid}/queries/execute", json={"sql": "SELECT * FROM sales"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "unknown_table"


def test_cancel_running_query(tmp_path):
    import polars as pl

    p = tmp_path / "d.parquet"
    pl.DataFrame({"a": list(range(3000))}).write_parquet(p)
    key = uuid.uuid4().hex
    outcome: dict[str, object] = {}

    def run() -> None:
        try:
            query_engine.execute("SELECT sum(hash(a.a * 7 + b.a * 13 + c.a)) FROM d a, d b, d c", {"d": p},
                                 key=key, timeout=30)
        except Exception as exc:
            outcome["exc"] = exc

    t = threading.Thread(target=run)
    t.start()
    for _ in range(100):
        if query_engine.cancel(key):
            break
        time.sleep(0.02)
    t.join(10)
    assert isinstance(outcome.get("exc"), query_engine.QueryCancelled)


def test_integer_aggregates_stay_integers(sales_dataset):
    api, pid, _ = sales_dataset
    r = api.post(f"/api/v1/projects/{pid}/queries/execute",
                 json={"sql": "SELECT sum(quantity) AS units, sum(unit_price) AS price FROM sales"}).json()
    units, price = r["rows"][0]
    assert units == 18 and isinstance(units, int)  # HUGEINT sum, not 18.0
    assert isinstance(price, float)
