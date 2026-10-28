"""Application configuration loaded from environment variables (prefix AETHER_)."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

API_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = API_ROOT.parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AETHER_", env_file=(str(REPO_ROOT / ".env"), ".env"), extra="ignore"
    )

    env: Literal["development", "test", "production"] = "development"
    # PostgreSQL is the primary metadata store; SQLite is the lightweight single-user profile.
    database_url: str = f"sqlite:///{(REPO_ROOT / 'storage' / 'aether.db').as_posix()}"
    storage_dir: Path = REPO_ROOT / "storage"

    cors_origins: list[str] = ["http://127.0.0.1:5173", "http://localhost:5173"]

    session_ttl_hours: int = 24 * 7
    cookie_secure: bool = False  # must be true when served over HTTPS
    allow_registration: bool = True

    max_upload_mb: int = 512
    max_request_mb: int = 4  # non-upload request bodies

    query_timeout_seconds: float = 30.0
    query_memory_limit: str = "2GB"
    query_threads: int = 4
    max_result_rows: int = 10_000
    max_query_chars: int = 100_000

    # embedded: worker thread inside the API process (dev / single user)
    # external: run `python -m app.workers.runner` separately (docker-compose)
    # inline:   jobs execute synchronously when enqueued (tests)
    worker_mode: Literal["embedded", "external", "inline"] = "embedded"
    worker_poll_seconds: float = 1.0
    job_stale_after_seconds: int = 300

    log_level: str = "INFO"
    log_json: bool = True

    rate_limit_auth_per_minute: int = 20

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()
