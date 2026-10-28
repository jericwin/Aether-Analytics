# Development

## Setup

```bash
cd apps/api && uv sync                 # Python deps incl. dev tools (pytest, ruff)
cd apps/web && pnpm install
cd apps/web && pnpm exec playwright install chromium   # once, for e2e
```

Run both with hot reload: `./scripts/dev.sh` (or `pwsh scripts/dev.ps1`). Vite serves
http://127.0.0.1:5173 and proxies `/api` to the API on :8000, so cookies stay same-origin.

## Commands

| Where | Command | What |
|---|---|---|
| api | `uv run aether serve [--reload]` | migrate + run API (serves `apps/web/dist` if built) |
| api | `uv run aether worker` | standalone worker (`AETHER_WORKER_MODE=external`) |
| api | `uv run pytest` | 85 tests; `AETHER_TEST_DATABASE_URL=postgresql+psycopg://…` to run on PostgreSQL |
| api | `uv run ruff check app tests` | lint (line length 120) |
| api | `uv run aether migrate && uv run alembic check` | models ↔ migrations drift check (needs a migrated DB) |
| api | `uv run aether benchmark --out ../../docs/benchmarks` | performance benchmark |
| web | `pnpm typecheck` / `pnpm test` / `pnpm build` | strict TS, Vitest (15 tests), production build |
| web | `pnpm e2e` | Playwright workflows against a real server with a fresh DB |
| web | `E2E_BASE_URL=http://127.0.0.1:8080 pnpm e2e` | same workflows against a running deployment (e.g. docker compose) |
| root | `docker compose up --build -d` | full stack (PostgreSQL 17 + API + worker), see README |
| web | `AETHER_SCREENSHOTS=1 pnpm exec playwright test screenshots` | regenerate `docs/screenshots` |

## Conventions

- **Routes are thin.** `api/v1/*` parse, authorize through `security/deps`, call a service, shape
  the response. Business rules and transactions live in `services/`.
- **One path to data.** Anything that reads analytical data goes through `sql_guard` and then
  `query_engine`. Generate SQL with `sql_builder.ident()` and `literal()`, never with
  f-string interpolation of user values.
- **Errors**: raise `AppError` subclasses with a stable `code`. Never return raw exceptions.
- **Schema changes**: edit models → `alembic revision --autogenerate` → review → test on both DBs.
- **Frontend**: server state only through `src/services/hooks.ts`. Keep pure logic (chart
  options, validation, formatting) outside components so it can be unit-tested. Use colour and
  spacing tokens, not raw hex, in components. TypeScript is strict, with
  `noUncheckedIndexedAccess`, and no `any` in app code.
- **Accessibility**: label every control (the `Field` helper wires `htmlFor` and
  `aria-describedby`), show status as icon + text, keep focus rings visible.
- **Tests**: add backend tests for business rules and security behaviour. Add e2e coverage for
  new user-facing workflows. Use deterministic fixtures (seeded generators, inline CSV).

## Toolchain notes

- TypeScript is pinned to 5.9 (`~5.9.3`). TypeScript 7 (native) was available but is not
  adopted yet.
- react-grid-layout 2.x has a new API (`gridConfig`, `dragConfig`, `resizeConfig`). Width is
  measured with `useElementWidth` (a callback-ref ResizeObserver) because the library's hook only
  measures elements present on first mount.
- Monaco is bundled locally (`loader.config({ monaco })`, worker via `?worker`), so the editor
  never requests a CDN.
- DuckDB 2.0: results are fetched with `con.sql(...).to_arrow_table()`.
