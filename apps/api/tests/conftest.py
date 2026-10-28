"""Test configuration: each test session uses an isolated SQLite DB + storage directory, the schema
is created through the real Alembic migrations, and jobs execute inline (synchronously)."""

import io
import os
import shutil
import tempfile
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

_TMP = Path(tempfile.mkdtemp(prefix="aether-test-"))
# Set AETHER_TEST_DATABASE_URL=postgresql+psycopg://... to run the suite against PostgreSQL
# (the schema is dropped and rebuilt through the migrations). Defaults to a throwaway SQLite file.
_TEST_DB = os.environ.get("AETHER_TEST_DATABASE_URL") or f"sqlite:///{(_TMP / 'test.db').as_posix()}"
if _TEST_DB.startswith("postgresql"):
    import sqlalchemy as _sa

    _engine = _sa.create_engine(_TEST_DB, isolation_level="AUTOCOMMIT")
    with _engine.connect() as _conn:
        _conn.execute(_sa.text("DROP SCHEMA public CASCADE"))
        _conn.execute(_sa.text("CREATE SCHEMA public"))
    _engine.dispose()
os.environ.update({
    "AETHER_ENV": "test",
    "AETHER_DATABASE_URL": _TEST_DB,
    "AETHER_STORAGE_DIR": str(_TMP / "storage"),
    "AETHER_WORKER_MODE": "inline",
    "AETHER_LOG_JSON": "false",
    "AETHER_LOG_LEVEL": "WARNING",
    "AETHER_RATE_LIMIT_AUTH_PER_MINUTE": "1000",
})

from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from alembic import command  # noqa: E402

API_DIR = Path(__file__).resolve().parents[1]


def _migrate() -> None:
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "alembic"))
    command.upgrade(cfg, "head")


_migrate()

from app.main import create_app  # noqa: E402
from app.security.auth import CSRF_COOKIE, auth_rate_limiter  # noqa: E402


def pytest_sessionfinish(session: Any, exitstatus: int) -> None:
    from app.db.session import get_engine

    get_engine().dispose()
    shutil.rmtree(_TMP, ignore_errors=True)


class Api:
    """Thin wrapper over TestClient that sends the CSRF header like the web app does."""

    def __init__(self, client: TestClient) -> None:
        self.client = client

    def _headers(self) -> dict[str, str]:
        token = self.client.cookies.get(CSRF_COOKIE)
        return {"X-CSRF-Token": token} if token else {}

    def get(self, url: str, **kw: Any) -> Any:
        return self.client.get(url, **kw)

    def post(self, url: str, **kw: Any) -> Any:
        return self.client.post(url, headers=self._headers() | kw.pop("headers", {}), **kw)

    def put(self, url: str, **kw: Any) -> Any:
        return self.client.put(url, headers=self._headers() | kw.pop("headers", {}), **kw)

    def patch(self, url: str, **kw: Any) -> Any:
        return self.client.patch(url, headers=self._headers() | kw.pop("headers", {}), **kw)

    def delete(self, url: str, **kw: Any) -> Any:
        return self.client.delete(url, headers=self._headers() | kw.pop("headers", {}), **kw)

    # ---- workflow helpers
    def create_project(self, name: str = "Test project") -> dict[str, Any]:
        r = self.post("/api/v1/projects", json={"name": name})
        assert r.status_code == 201, r.text
        return r.json()

    def upload(self, project_id: str, filename: str, content: bytes) -> Any:
        return self.post(f"/api/v1/projects/{project_id}/uploads", files={"file": (filename, io.BytesIO(content))})

    def import_file(self, project_id: str, filename: str, content: bytes, name: str | None = None,
                    options: dict[str, Any] | None = None, table_name: str | None = None) -> dict[str, Any]:
        up = self.upload(project_id, filename, content)
        assert up.status_code == 201, up.text
        body: dict[str, Any] = {"source_id": up.json()["id"], "name": name or Path(filename).stem,
                                "options": options or {}}
        if table_name:
            body["table_name"] = table_name
        r = self.post(f"/api/v1/projects/{project_id}/datasets", json=body)
        assert r.status_code == 202, r.text
        return r.json()


_counter = {"n": 0}


def make_user(app: Any, name: str | None = None) -> Api:
    _counter["n"] += 1
    client = TestClient(app)
    api = Api(client)
    email = f"{name or 'user'}{_counter['n']}@example.com"
    r = client.post("/api/v1/auth/register", json={"email": email, "display_name": name or "User",
                                                   "password": "correct-horse-battery"})
    assert r.status_code == 201, r.text
    api.email = email  # type: ignore[attr-defined]
    return api


@pytest.fixture(scope="session")
def app() -> Any:
    return create_app()


@pytest.fixture
def api(app: Any) -> Iterator[Api]:
    auth_rate_limiter.reset()
    yield make_user(app)


@pytest.fixture
def other_api(app: Any) -> Api:
    return make_user(app, "other")


SALES_CSV = (
    b"order_id,order_date,region,product,quantity,unit_price,returned\n"
    b"1,2024-01-05,North,Widget,2,10.00,false\n"
    b"2,2024-01-17,South,Gadget,1,25.50,false\n"
    b"3,2024-02-03,North,Gadget,3,25.50,true\n"
    b"4,2024-02-20,East,Widget,5,10.00,false\n"
    b"5,2024-03-11,South,Widget,,10.00,false\n"
    b"6,2024-03-28,North,Doohickey,1,99.99,false\n"
    b"7,2024-04-02,East,Gadget,2,25.50,\n"
    b"8,2024-04-15,West,Widget,4,10.00,false\n"
)


@pytest.fixture
def sales_dataset(api: Api) -> tuple[Api, str, dict[str, Any]]:
    project = api.create_project("Sales")
    started = api.import_file(project["id"], "sales.csv", SALES_CSV, name="Sales")
    assert started["job"]["status"] == "succeeded", started["job"]
    return api, project["id"], started["dataset"]
