# Database

Application metadata lives in **PostgreSQL** (primary) or **SQLite** (single-user profile). The
schema is identical on both. JSON columns use `JSON` with a `JSONB` variant on PostgreSQL.
Analytical data is **not** stored here (see Parquet storage in ARCHITECTURE.md).

## Migrations

Schema changes are made only through Alembic (`apps/api/alembic/versions`). Constraint names
are deterministic (naming convention in `app/db/base.py`), so migrations are portable, and
SQLite uses batch mode for ALTERs.

```bash
uv run aether migrate                    # = alembic upgrade head (also run by `aether serve`)
uv run alembic revision --autogenerate -m "describe change"   # then review the generated file
uv run alembic check                     # fails if models and migrations disagree (run in CI)
uv run alembic downgrade -1
```

Verified: `0001` upgrades, downgrades and re-upgrades on SQLite. The full test suite (which
builds its schema through the migrations) passes on SQLite and PostgreSQL 16, and the Docker
stack runs on PostgreSQL 17.

## Tables (migration 0001)

| Table | Key columns | Relationships and deletion behaviour |
|---|---|---|
| `users` | email (unique), display_name, password_hash (Argon2id), is_active | — |
| `sessions` | token_hash (unique, SHA-256 of the cookie token), csrf_token, expires_at | → users CASCADE |
| `projects` | name, description, status (`active`/`archived`, indexed), is_demo | owner → users SET NULL |
| `project_members` | PK (project_id, user_id), role (`viewer`/`editor`/`owner`) | → projects CASCADE, → users CASCADE |
| `data_sources` | original_filename, storage_path, file_format, size_bytes, content_hash, detected (JSON) | → projects CASCADE |
| `datasets` | name, table_name (unique per project), status, current_version, error_message | → projects CASCADE; source → data_sources SET NULL |
| `dataset_versions` | UNIQUE(dataset_id, version), storage_path, row/column counts, content_hash, import_options, warnings, profile (JSON), job_id | → datasets CASCADE |
| `dataset_columns` | UNIQUE(version_id, position), name, logical_type, physical_type, null_count | → dataset_versions CASCADE |
| `saved_queries` | name, sql | → projects CASCADE |
| `query_history` | sql, status, duration_ms, row_count, truncated, error; index (project_id, created_at) | → projects CASCADE |
| `dashboards` | name, description | → projects CASCADE |
| `dashboard_widgets` | chart_type, title, position, config (JSON), layout (JSON) | → dashboards CASCADE; dataset → datasets **NO ACTION** |
| `dashboard_filters` | column, filter_type, label, position, default_value | → dashboards CASCADE; dataset → datasets **NO ACTION** |
| `jobs` | job_type, status, progress, payload/result (JSON), cancel_requested, attempts, error_code/message, heartbeat_at; indexes (status, created_at), (project_id, created_at) | → projects CASCADE |
| `audit_logs` | action, resource_type/id, summary, details; index (project_id, created_at) | no FK to projects, so entries outlive deleted projects |

### Why `NO ACTION` for widget/filter → dataset

`RESTRICT` is checked immediately in PostgreSQL. Deleting a project would then fail, because the
dataset cascade runs before the dashboard cascade has removed the widgets. `NO ACTION` is checked
at the end of the statement, so project deletion succeeds while deleting a single dataset that
a widget still uses is refused. The service layer checks first and returns a readable list of
dependents (`dataset_in_use`). Covered by `test_dataset_in_use_cannot_be_deleted_but_project_can`
on both databases.

## Versioning model

- A dataset version is immutable: a new import writes `v{n+1}.parquet`, and old files are never
  rewritten.
- `datasets.current_version` points at the version used by SQL, charts and the explorer.
  Older versions remain browsable (`POST …/rows {"version": 1}`).
- Each version records its source upload, import options, warnings, content hash, and the
  job that produced it.

## Backup

See README → *Backup and restore*. Archives contain a consistent DB snapshot (SQLite backup API
or `pg_dump -Fc`) plus the storage tree. Restore validates every archive path (zip-slip) and
runs migrations after restoring.

**Version matching:** `pg_restore` aborts when a newer `pg_dump` emitted settings the server
doesn't know (e.g. pg_dump 17 writes `SET transaction_timeout`, which PostgreSQL 16 rejects).
Use client tools of the same major version as the server. docker-compose pins PostgreSQL 17 to
match the image's client. CI uses server 16 with Ubuntu's client 16.
