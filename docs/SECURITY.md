# Security

## Authentication

- Passwords: Argon2id (`argon2-cffi` defaults), minimum 10 characters. Unknown emails still pay
  the hashing cost, so response timing doesn't reveal which accounts exist.
- Sessions: a 256-bit random token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` when
  `AETHER_COOKIE_SECURE=true`). Only its SHA-256 hash is stored. Sessions expire
  (`AETHER_SESSION_TTL_HOURS`), and logout deletes the server-side row.
- CSRF: every state-changing request must send `X-CSRF-Token` matching the session's token
  (readable `aether_csrf` cookie, compared in constant time). Tested in `test_csrf_required_for_mutations`.
- Rate limiting: login and registration attempts per IP and per email (in-process; see limitations).
- The first account can always be created. Later self-registration is controlled by
  `AETHER_ALLOW_REGISTRATION`.

## Authorization

Every project-scoped route resolves `(project, role)` from `project_members` for the
authenticated user (`security/deps.py`). Project, dataset, dashboard and query IDs from the
client are never trusted: each nested resource is also checked to belong to that project.
Non-members get **404**, not 403, so project IDs cannot be probed. Roles:

| | viewer | editor | owner |
|---|---|---|---|
| View data, run SQL, view dashboards | ✓ | ✓ | ✓ |
| Import, edit datasets, queries, dashboards | | ✓ | ✓ |
| Members, archive, delete project | | | ✓ |

Jobs are visible only to members of their project. SQL cancellation keys are namespaced by user.

## Uploads and files

- Allow-listed extensions, **and** the content must match (Parquet magic at both ends, XLSX zip
  containing `xl/workbook.xml`, OLE header for XLS, JSON start byte, no NUL bytes in text).
- Streaming size limit (`AETHER_MAX_UPLOAD_MB`), plus a `Content-Length` check for other
  requests (`AETHER_MAX_REQUEST_MB`).
- Stored names are server-generated UUIDs. Every path goes through `safe_path()`, which rejects
  anything resolving outside the storage root. Restore rejects zip-slip entries (tested).

## SQL execution

Two independent layers (see ARCHITECTURE.md). Each is tested on its own:

1. **Guard** (`analytics/sql_guard.py`): parsed with sqlglot, never regex. It requires exactly
   one statement, which must be a query. It rejects DDL/DML, COPY, ATTACH, INSTALL/LOAD, PRAGMA,
   SET, EXPORT, DESCRIBE/SUMMARIZE/SHOW, table functions and string paths in `FROM`, qualified
   names (`main.t`), unknown tables (including other projects' tables), and file/remote/
   introspection functions (`read_*`, `glob`, `*_scan`, `query`, `getenv`, `current_setting`,
   `duckdb_*`, …). The executed SQL is regenerated from the AST.
2. **Engine** (`analytics/query_engine.py`): a fresh in-memory DuckDB per execution, with views
   only for referenced datasets, `allowed_paths` set to those Parquet files,
   `enable_external_access=false`, `lock_configuration=true`, extension autoload and autoinstall
   off, a memory limit, a thread cap, a wall-clock timeout via `interrupt()`, and a bounded result.

`tests/test_sql.py` runs 29 malicious or malformed queries against the guard and verifies that
the engine alone blocks file reads and `glob()` even when the guard is bypassed.

## Errors, logs and audit

- Errors return `{error: {code, message, request_id, details}}`. Unhandled exceptions return a
  generic message. Stack traces, SQL engine internals and filesystem paths stay in server logs.
- Logs are structured JSON with request IDs. Passwords, tokens and dataset rows are never logged.
- `audit_logs` records logins, registrations, project, dataset, query and dashboard changes,
  membership changes and imports.
- Response headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: same-origin`, and `Cache-Control: no-store` on API responses.

## Deployment precautions

- Default binding is `127.0.0.1`. `aether serve --host 0.0.0.0` prints a warning.
- For anything beyond localhost: serve over HTTPS via a reverse proxy, set
  `AETHER_COOKIE_SECURE=true`, set `AETHER_CORS_ORIGINS`, disable open registration, and use
  PostgreSQL with a strong password.
- Secrets live only in `.env`, which is git-ignored. `.env.example` contains placeholders only.
- Backup tooling passes the database password via `PGPASSWORD`, never argv, so it can't appear in
  process listings or error messages (tested).
- Keep dependencies updated (`uv lock --upgrade`, `pnpm update`) and re-run the test suites.

## Known limitations

- The rate limiter is in-process. Scaling the API horizontally needs a shared store.
- There is no CSP header yet (the SPA uses no inline scripts except the theme bootstrap).
- There is no MFA or password reset flow (local-first, single-node scope).
