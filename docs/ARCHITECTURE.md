# Architecture

Aether is a **modular monolith**: one API process (plus optional separate workers) with strict
internal module boundaries. No microservices. See [ADR 0001](DECISIONS/0001-modular-monolith.md).

```
apps/
  api/                      Python 3.12+, FastAPI
    app/api/v1/             HTTP routes only: parse, authorize, call services, shape responses
    app/security/           sessions, CSRF, password hashing, project authorization dependencies
    app/services/           business logic and transactions (projects, datasets, queries, dashboards, audit)
    app/ingestion/          content sniffing, source adapters, schema inference
    app/analytics/          profiling, SQL guard, sandboxed query engine, SQL builder, chart compiler
    app/workers/            durable job queue, handlers, standalone runner
    app/models/ schemas/    SQLAlchemy metadata models / Pydantic API contracts
    app/core/               config, logging, errors, storage path isolation
    app/demo.py backup.py benchmark.py cli.py
    alembic/                migrations
  web/                      React 19 + TypeScript (strict) + Vite
    src/services/hooks.ts   all server state (TanStack Query); components never call fetch
    src/lib/api.ts          typed client: CSRF header, error normalisation
    src/features/*          auth, home, projects, datasets, profiling, sql-workbench, dashboards, jobs, settings
    src/components/         UI primitives (Radix-based), DataGrid (virtualised), ECharts wrapper + option builder
```

## Data flow

### Import

1. `POST /projects/{id}/uploads` streams the file to `storage/uploads/{project}/{uuid}.{ext}`,
   enforcing the size limit and hashing as it goes. The magic bytes must match the extension
   (`ingestion/formats.py`). Format facts (delimiter, encoding, sheets) are recorded on a
   `data_sources` row.
2. `POST /uploads/{id}/preview` runs the **same** `load_frame()` as the real import on the
   first 50 rows: adapter → column-name normalisation → nested flattening → unambiguous date
   detection → strict type overrides.
3. `POST /projects/{id}/datasets` creates the dataset (`status=importing`) and enqueues a
   `dataset_import` job.
4. The worker parses the full file, writes `datasets/{project}/{dataset}/v{n}.parquet` via a
   temp file plus atomic rename, hashes it, profiles it, then registers `dataset_versions` and
   `dataset_columns` and flips the dataset to `ready` in one transaction.

### Query

Every analytical read (SQL workbench, table browser, chart widgets, filter value lists, exports)
goes through the same two layers:

```
request ──► sql_guard.validate_query()         layer 1: sqlglot AST, allow-list of tables/CTEs,
            (regenerates SQL from the AST)       forbidden statements & functions
        ──► query_engine.execute()             layer 2: fresh in-memory DuckDB connection,
            views over approved Parquet only     allowed_paths = those files, external access off,
                                                 configuration locked, memory/threads/timeout,
                                                 LIMIT max_rows+1 for truncation detection
```

Structured features (`sql_builder.py`, `chart_query.py`) generate SQL from validated column
names and typed literals, then still pass through the guard. One security path, no exceptions.

### Dashboards

Widgets persist **configuration only** (`ChartQuery` + display settings + grid layout). Data is
always recomputed from the dataset's *current* version, so re-imports flow through. Dashboard
filters are sent with each chart request and apply only to widgets on the same dataset.
Cross-filters are client-side state, sent the same way.

## Storage boundaries

| Store | Contents | Why |
|---|---|---|
| PostgreSQL / SQLite | users, sessions, projects, members, datasets and versions, columns, queries, history, dashboards, jobs, audit | transactional metadata, FK integrity |
| Parquet files | dataset versions (immutable) | columnar, compressed, read directly by DuckDB and Polars |
| Filesystem | uploads, exports | original files kept for re-import and lineage |

Metadata never holds dataset rows. Paths are stored relative to the storage root and resolved
through `core/storage.safe_path()`, which rejects anything escaping the root.

## Workers

See [ADR 0003](DECISIONS/0003-db-backed-job-queue.md). Jobs are rows. A worker claims one with
`UPDATE … WHERE status='pending'` (atomic on both databases), heartbeats through
`JobContext.progress()`, and checks `cancel_requested` at each checkpoint. Stale `running` jobs
are re-queued (max 3 attempts). Modes: `embedded` (a thread in the API, the default for local
use), `external` (`aether worker`, used by docker-compose), and `inline` (tests).

## Frontend

- Routing: `react-router` data router; heavy routes (datasets, SQL, dashboards) are lazy chunks.
  Monaco (~2.7 MB) and ECharts load only where needed.
- Server state: TanStack Query; polling only while imports or jobs are active.
- Charts: `chartOptions.ts` is a pure function (query + display + result + theme tokens →
  ECharts option), unit-tested. Colours come from CSS tokens validated for colour-vision
  deficiency in both themes ([ADR 0004](DECISIONS/0004-chart-design.md)).
- Theme: CSS custom properties with separately chosen dark values; an explicit toggle overrides
  the OS preference in both directions.
