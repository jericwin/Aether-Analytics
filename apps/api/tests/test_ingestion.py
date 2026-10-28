import io
import json

import polars as pl
import pytest

from tests.conftest import SALES_CSV, Api


def _types(api: Api, pid: str, dsid: str) -> dict[str, str]:
    detail = api.get(f"/api/v1/projects/{pid}/datasets/{dsid}").json()
    return {c["name"]: c["logical_type"] for c in detail["version"]["columns"]}


def test_csv_import_end_to_end(sales_dataset):
    api, pid, ds = sales_dataset
    detail = api.get(f"/api/v1/projects/{pid}/datasets/{ds['id']}").json()
    assert detail["status"] == "ready" and detail["current_version"] == 1
    assert detail["row_count"] == 8 and detail["column_count"] == 7
    assert detail["table_name"] == "sales" and detail["source_filename"] == "sales.csv"
    assert len(detail["version"]["content_hash"]) == 64
    assert _types(api, pid, ds["id"]) == {
        "order_id": "integer", "order_date": "date", "region": "string", "product": "string",
        "quantity": "integer", "unit_price": "float", "returned": "boolean",
    }


def test_preview_shows_sample_schema_and_warnings(api: Api):
    pid = api.create_project()["id"]
    up = api.upload(pid, "semi.csv", b"a;b\n1;x\n2;y\n").json()
    assert up["detected"]["delimiter"] == ";"
    pv = api.post(f"/api/v1/projects/{pid}/uploads/{up['id']}/preview", json={"options": {}}).json()
    assert [c["name"] for c in pv["columns"]] == ["a", "b"]
    assert pv["rows"] == [[1, "x"], [2, "y"]]
    assert any("Delimiter auto-detected" in w for w in pv["warnings"])


def test_ambiguous_dates_are_not_guessed(api: Api):
    pid = api.create_project()["id"]
    csv = b"d,iso,dmy\n05/01/2024,2024-01-05,13/01/2024\n07/02/2024,2024-02-07,01/02/2024\n"
    started = api.import_file(pid, "dates.csv", csv)
    types = _types(api, pid, started["dataset"]["id"])
    assert types == {"d": "string", "iso": "date", "dmy": "date"}  # 13/01 disambiguates dd/mm
    warnings = started["job"]["result"]["warnings"]
    assert any("ambiguous" in w and "'d'" in w for w in warnings)


def test_mixed_type_column_stays_text_and_is_flagged(api: Api):
    pid = api.create_project()["id"]
    rows = "\n".join(str(i) for i in range(30)) + "\nN/A?\n"
    started = api.import_file(pid, "mixed.csv", ("v\n" + rows).encode())
    ds = started["dataset"]["id"]
    assert _types(api, pid, ds) == {"v": "string"}
    prof = api.get(f"/api/v1/projects/{pid}/datasets/{ds}/profile").json()["profile"]
    col = prof["columns"][0]
    assert col["invalid_count"] == 1 and col["invalid_examples"] == ["N/A?"]


def test_type_override_is_strict(api: Api):
    pid = api.create_project()["id"]
    up = api.upload(pid, "o.csv", b"code\n001\n002\nabc\n").json()
    r = api.post(f"/api/v1/projects/{pid}/uploads/{up['id']}/preview",
                 json={"options": {"type_overrides": {"code": "integer"}}})
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "invalid_cast" and err["details"]["failed"] == 1


def test_extension_content_mismatch_rejected(api: Api):
    pid = api.create_project()["id"]
    r = api.upload(pid, "fake.parquet", b"a,b\n1,2\n")
    assert r.status_code == 422 and r.json()["error"]["code"] == "format_mismatch"
    r = api.upload(pid, "evil.exe", b"MZ....")
    assert r.status_code == 422 and r.json()["error"]["code"] == "unsupported_format"
    r = api.upload(pid, "empty.csv", b"")
    assert r.status_code == 422


def test_parquet_import(api: Api):
    pid = api.create_project()["id"]
    buf = io.BytesIO()
    pl.DataFrame({"x": [1.5, 2.5, None], "y": ["a", "b", "c"]}).write_parquet(buf)
    started = api.import_file(pid, "data.parquet", buf.getvalue())
    assert started["job"]["status"] == "succeeded"
    assert _types(api, pid, started["dataset"]["id"]) == {"x": "float", "y": "string"}


def test_excel_import_with_sheet_selection(api: Api):
    import xlsxwriter

    pid = api.create_project()["id"]
    buf = io.BytesIO()
    wb = xlsxwriter.Workbook(buf)
    ws1 = wb.add_worksheet("Summary")
    ws1.write_row(0, 0, ["note"])
    ws1.write_row(1, 0, ["ignore me"])
    ws2 = wb.add_worksheet("Data")
    ws2.write_row(0, 0, ["region", "revenue"])
    ws2.write_row(1, 0, ["North", 120.5])
    ws2.write_row(2, 0, ["South", 80])
    wb.close()
    up = api.upload(pid, "book.xlsx", buf.getvalue()).json()
    assert up["detected"]["sheets"] == ["Summary", "Data"]
    r = api.post(f"/api/v1/projects/{pid}/datasets",
                 json={"source_id": up["id"], "name": "Book", "options": {"sheet": "Data"}})
    assert r.json()["job"]["status"] == "succeeded", r.json()
    ds = r.json()["dataset"]["id"]
    assert _types(api, pid, ds) == {"region": "string", "revenue": "float"}
    rows = api.post(f"/api/v1/projects/{pid}/datasets/{ds}/rows", json={}).json()["rows"]
    assert rows == [["North", 120.5], ["South", 80.0]]


@pytest.mark.parametrize("content,expected_cols", [
    (json.dumps([{"a": 1, "b": {"c": 2}}, {"a": 2, "b": {"c": 3}}]).encode(), ["a", "b.c"]),
    (b'{"a": 1, "t": "x"}\n{"a": 2, "t": "y"}\n', ["a", "t"]),
    (json.dumps({"meta": 1, "data": [{"k": 1}, {"k": 2}]}).encode(), ["k"]),
])
def test_json_shapes(api: Api, content: bytes, expected_cols: list[str]):
    pid = api.create_project()["id"]
    started = api.import_file(pid, "d.json", content)
    assert started["job"]["status"] == "succeeded", started["job"]
    assert list(_types(api, pid, started["dataset"]["id"])) == expected_cols


def test_unsupported_json_is_explained(api: Api):
    pid = api.create_project()["id"]
    started = api.import_file(pid, "bad.json", json.dumps({"a": [1], "b": [2]}).encode())
    job = started["job"]
    assert job["status"] == "failed" and job["error_code"] == "unsupported_json"
    ds = api.get(f"/api/v1/projects/{pid}/datasets/{started['dataset']['id']}").json()
    assert ds["status"] == "failed" and "Unsupported JSON" in ds["error_message"]


def test_latin1_encoding(api: Api):
    pid = api.create_project()["id"]
    content = "city,pop\nZürich,415000\nMálaga,578000\n".encode("latin-1")
    up = api.upload(pid, "cities.csv", content).json()
    r = api.post(f"/api/v1/projects/{pid}/uploads/{up['id']}/preview", json={"options": {"encoding": "utf-8"}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "encoding_error"
    r = api.post(f"/api/v1/projects/{pid}/uploads/{up['id']}/preview", json={"options": {"encoding": "latin-1"}})
    assert r.json()["rows"][0] == ["Zürich", 415000]


def test_new_version_and_history(sales_dataset):
    api, pid, ds = sales_dataset
    up = api.upload(pid, "sales_v2.csv", SALES_CSV + b"9,2024-05-01,North,Widget,1,10.00,false\n").json()
    job = api.post(f"/api/v1/projects/{pid}/datasets/{ds['id']}/versions", json={"source_id": up["id"]}).json()
    assert job["status"] == "succeeded"
    detail = api.get(f"/api/v1/projects/{pid}/datasets/{ds['id']}").json()
    assert detail["current_version"] == 2 and detail["row_count"] == 9
    assert [v["version"] for v in detail["versions"]] == [2, 1]
    v1 = api.post(f"/api/v1/projects/{pid}/datasets/{ds['id']}/rows", json={"version": 1}).json()
    assert v1["total"] == 8


def test_browse_sort_filter_paginate_export(sales_dataset):
    api, pid, ds = sales_dataset
    url = f"/api/v1/projects/{pid}/datasets/{ds['id']}"
    r = api.post(f"{url}/rows", json={
        "limit": 2, "offset": 1, "sort": [["unit_price", "desc"], ["order_id", "asc"]],
        "filters": [{"column": "region", "op": "in", "values": ["North", "South"]}],
        "columns": ["order_id", "region", "unit_price"],
    }).json()
    assert r["total"] == 5
    assert r["rows"] == [[2, "South", 25.5], [3, "North", 25.5]]
    r = api.post(f"{url}/rows", json={"filters": [{"column": "quantity", "op": "is_null"}]}).json()
    assert r["total"] == 1 and r["rows"][0][0] == 5
    r = api.post(f"{url}/rows", json={"filters": [{"column": "nope", "op": "eq", "value": 1}]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "unknown_column"
    r = api.post(f"{url}/rows", json={"filters": [{"column": "quantity", "op": "gt", "value": "1; DROP"}]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_filter_value"
    exp = api.post(f"{url}/export", json={"filters": [{"column": "region", "op": "eq", "value": "East"}]})
    assert exp.status_code == 200 and exp.headers["content-type"].startswith("text/csv")
    lines = exp.text.strip().splitlines()
    assert lines[0].startswith("order_id,") and len(lines) == 3


def test_dataset_rename_delete(sales_dataset):
    api, pid, ds = sales_dataset
    r = api.patch(f"/api/v1/projects/{pid}/datasets/{ds['id']}", json={"name": "Sales 2024"})
    assert r.json()["name"] == "Sales 2024" and r.json()["table_name"] == "sales"
    assert api.delete(f"/api/v1/projects/{pid}/datasets/{ds['id']}").status_code == 204
    assert api.get(f"/api/v1/projects/{pid}/datasets/{ds['id']}").status_code == 404


def test_table_name_conflicts_get_suffix(api: Api):
    pid = api.create_project()["id"]
    a = api.import_file(pid, "a.csv", b"x\n1\n", name="Orders")
    b = api.import_file(pid, "b.csv", b"x\n2\n", name="Orders")
    assert a["dataset"]["table_name"] == "orders" and b["dataset"]["table_name"] == "orders_2"
    up = api.upload(pid, "c.csv", b"x\n1\n").json()
    r = api.post(f"/api/v1/projects/{pid}/datasets", json={"source_id": up["id"], "name": "x", "table_name": "select"})
    assert r.status_code == 422
