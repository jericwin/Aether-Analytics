from fastapi.testclient import TestClient

from app.db.session import get_engine, get_sessionmaker
from tests.conftest import Api, make_user


def test_health(app):
    c = TestClient(app)
    assert c.get("/api/v1/health").json() == {"status": "ok"}
    ready = c.get("/api/v1/health/ready").json()
    assert ready["status"] == "ok" and ready["checks"]["database"]["ok"]


def test_unauthenticated_requests_are_rejected(app):
    c = TestClient(app)
    r = c.get("/api/v1/projects")
    assert r.status_code == 401
    body = r.json()["error"]
    assert body["code"] == "unauthorized" and body["request_id"]


def test_register_login_logout(app):
    api = make_user(app, "alice")
    assert api.get("/api/v1/auth/me").status_code == 200
    assert api.post("/api/v1/auth/logout").status_code == 204
    assert api.get("/api/v1/auth/me").status_code == 401
    bad = api.post("/api/v1/auth/login", json={"email": api.email, "password": "wrong-password"})
    assert bad.status_code == 401 and bad.json()["error"]["code"] == "invalid_credentials"
    ok = api.post("/api/v1/auth/login", json={"email": api.email, "password": "correct-horse-battery"})
    assert ok.status_code == 200
    assert api.get("/api/v1/auth/me").json()["email"] == api.email


def test_duplicate_email_and_weak_password(app):
    api = make_user(app)
    c = TestClient(app)
    r = c.post("/api/v1/auth/register", json={"email": api.email, "display_name": "x", "password": "long-enough-pw"})
    assert r.status_code == 409
    r = c.post("/api/v1/auth/register", json={"email": "new@example.com", "display_name": "x", "password": "short"})
    assert r.status_code == 422


def test_csrf_required_for_mutations(api: Api):
    r = api.client.post("/api/v1/projects", json={"name": "No CSRF"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "csrf_failed"
    r = api.client.post("/api/v1/projects", json={"name": "Bad CSRF"}, headers={"X-CSRF-Token": "forged"})
    assert r.status_code == 403


def test_project_crud_search_archive(api: Api):
    a = api.create_project("Revenue Analysis")
    api.create_project("Inventory")
    listing = api.get("/api/v1/projects", params={"search": "revenue"}).json()
    assert [p["name"] for p in listing["items"]] == ["Revenue Analysis"]
    r = api.patch(f"/api/v1/projects/{a['id']}", json={"name": "Revenue 2024", "status": "archived"})
    assert r.status_code == 200 and r.json()["status"] == "archived"
    archived = api.get("/api/v1/projects", params={"status": "archived"}).json()
    assert [p["name"] for p in archived["items"]] == ["Revenue 2024"]
    overview = api.get(f"/api/v1/projects/{a['id']}/overview").json()
    assert overview["dataset_count"] == 0
    assert [e["action"] for e in overview["activity"]][:2] == ["project.archived", "project.created"]
    assert api.delete(f"/api/v1/projects/{a['id']}").status_code == 204
    assert api.get(f"/api/v1/projects/{a['id']}").status_code == 404


def test_projects_persist_across_engine_restart(api: Api):
    p = api.create_project("Durable")
    # Simulate an application restart: drop pooled connections and session factories.
    get_engine().dispose()
    get_sessionmaker.cache_clear()
    got = api.get(f"/api/v1/projects/{p['id']}")
    assert got.status_code == 200 and got.json()["name"] == "Durable"


def test_access_control_between_users(api: Api, other_api: Api):
    p = api.create_project("Private")
    pid = p["id"]
    # Non-members cannot see that the project exists.
    assert other_api.get(f"/api/v1/projects/{pid}").status_code == 404
    assert other_api.get(f"/api/v1/projects/{pid}/datasets").status_code == 404
    assert other_api.post(f"/api/v1/projects/{pid}/queries/execute", json={"sql": "select 1"}).status_code == 404
    assert other_api.delete(f"/api/v1/projects/{pid}").status_code == 404
    assert pid not in [x["id"] for x in other_api.get("/api/v1/projects").json()["items"]]

    # Grant viewer: can read, cannot modify.
    r = api.put(f"/api/v1/projects/{pid}/members", json={"email": other_api.email, "role": "viewer"})
    assert r.status_code == 200
    assert other_api.get(f"/api/v1/projects/{pid}").json()["role"] == "viewer"
    assert other_api.patch(f"/api/v1/projects/{pid}", json={"name": "hijack"}).status_code == 403
    assert other_api.post(f"/api/v1/projects/{pid}/dashboards", json={"name": "x"}).status_code == 403
    assert other_api.delete(f"/api/v1/projects/{pid}").status_code == 403

    # Editor: can modify content but not delete/archive the project or manage members.
    api.put(f"/api/v1/projects/{pid}/members", json={"email": other_api.email, "role": "editor"})
    assert other_api.post(f"/api/v1/projects/{pid}/dashboards", json={"name": "ok"}).status_code == 201
    assert other_api.patch(f"/api/v1/projects/{pid}", json={"status": "archived"}).status_code == 403
    assert other_api.delete(f"/api/v1/projects/{pid}").status_code == 403

    # The last owner cannot be removed.
    me = api.get("/api/v1/auth/me").json()
    assert api.delete(f"/api/v1/projects/{pid}/members/{me['id']}").status_code == 409


def test_timestamps_are_timezone_aware(api: Api):
    p = api.create_project("TZ")
    assert p["created_at"].endswith(("Z", "+00:00"))
