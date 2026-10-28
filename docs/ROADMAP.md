# Roadmap

Status legend: ✅ implemented and tested · 🟡 implemented, partially tested · ⬜ not implemented.
Last updated 2026-10-29 (Docker verification).

## Phase 1: Foundation ✅
- ✅ Monorepo, FastAPI app factory, config, structured logging, error envelope with request IDs
- ✅ SQLAlchemy models, Alembic migration 0001 (verified on SQLite and PostgreSQL 16)
- ✅ Session auth, CSRF, Argon2id, roles, per-request project authorization, audit log
- ✅ Projects: CRUD, search, archive/restore, members, overview from real data, persistence across restart
- ✅ Health + readiness endpoints; app shell (collapsible sidebar, breadcrumbs, job indicator, themes)
- ✅ First-run onboarding and opt-in synthetic demo project

## Phase 2: Data ingestion ✅
- ✅ CSV / Parquet / XLSX / XLS (calamine) / JSON + NDJSON, content sniffing, preview, warnings
- ✅ Unambiguous date detection, strict type overrides, nested JSON flattening
- ✅ Versioned immutable Parquet, content hashes, version history, re-import
- ✅ Profiling engine (tested against reference statistics); quality scores and issues
- ✅ Server-side explorer (sort, filter, columns, pagination, CSV export)
- 🟡 XLS (legacy Excel) path is exercised only through the shared calamine reader; there is no dedicated fixture test

## Phase 3: SQL engine ✅
- ✅ Two-layer sandbox, timeouts, cancellation, bounded results, history, saved queries, export
- ✅ Monaco editor with schema completion, offline

## Phase 4: Dashboard builder ✅ (core)
- ✅ Grid layout, 12 widget types, config panel, persistence, date and category filters, cross-filter
- ✅ Table view, lineage/SQL view, PNG export, full-screen, print/PDF via browser
- ⬜ Drill-down (hierarchical), per-widget result caching with explicit invalidation
- ⬜ Server-rendered dashboard PDF (planned with the report builder)

## Phase 5: Visual ETL ⬜
- ⬜ React Flow editor; node types (select, rename, filter, sort, cast, fill nulls, dedupe,
  calculated column with restricted expression language, group/aggregate, join, append, sample,
  validate, output)
- ⬜ Backend DAG validation (cycles, missing inputs, type checks), topological Polars execution,
  previews, run history (`pipelines`, `pipeline_runs`, `pipeline_run_nodes`)

## Phase 6: Advanced analytics ⬜
- ⬜ Statistics workspace (descriptives, Pearson/Spearman, regression, t-test/chi-square with
  assumption checks), tested against reference values
- ⬜ Forecasting (moving-average baseline, exponential smoothing, backtesting, MAE/RMSE/MAPE)
- ⬜ Anomaly detection (IQR, z-score, rolling, residual). The demo data already contains labelled anomalies.
- ⬜ Data-quality rules (`data_quality_rules/runs/results`)
- ⬜ Report builder (PDF/XLSX/CSV via background jobs) and schedules
- ⬜ Lineage graph view (version → pipeline → widget/report). Basic widget lineage exists today.

## Phase 7: Optional local AI ⬜
- ⬜ Ollama adapter, structured proposals validated by the same SQL guard, grounded answers

## Phase 8: Hardening 🟡
- ✅ Backup/restore (SQLite + PostgreSQL round trips tested), benchmarks, e2e workflows A/C/E/F
- ✅ Docker Compose verified: build, e2e suite against the stack, persistence across container
  recreation, and a backup → `down -v` → restore drill
- 🟡 GitHub Actions CI written, not yet run (no remote). Its commands were run locally.
- ⬜ Workflows B (pipelines) and D (reports) depend on Phases 5 and 6
- ⬜ CSP header, shared rate-limit store for multi-node deployments

## Known issues
- About 60 ms fixed latency per analytical query from creating a sandboxed DuckDB connection.
  Candidate fix: a pool of pre-locked connections per project, invalidated when a dataset version changes.
- CSV import of 1M rows takes about 4 s, dominated by full-file type inference
  (`infer_schema_length=None`, chosen for correctness over speed).
- The histogram uses equal-width bins over [min, max], so heavy-tailed columns put most rows in
  the first bin. Quantile-clipped bins are a possible improvement.
- One backend test run (out of 11+) reported a single failure that never reproduced afterwards.
  Likely timing-sensitive. Watch `test_sql.py::test_cancel_running_query` and `test_engine_timeout` in CI.

## Next milestone (recommended)
**Phase 5, Visual ETL**: it unlocks workflow B, produces new dataset versions (exercising lineage),
and reuses the existing ingestion, versioning and job infrastructure.
