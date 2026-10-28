# 0005 — Two-layer SQL sandbox

**Status:** accepted (2026-10-28)

**Context.** Users (and, later, an optional AI assistant) submit arbitrary SQL. UI restrictions
are not security.

**Decision.** Layer 1: a sqlglot AST allow-list (single read-only query, approved tables and CTEs
only, forbidden functions, no table functions or qualified names), with SQL regenerated from
the AST. Layer 2: a per-execution in-memory DuckDB connection exposing only the referenced
Parquet files (`allowed_paths`), then `enable_external_access=false` and
`lock_configuration=true`, with memory, thread and time limits. All structured features
(browser, charts, filters, exports) use the same path.

**Consequences.** Each layer is independently tested. The fresh connection costs about 60 ms
per query (measured). A pool of pre-locked connections keyed by project and dataset versions is
the planned optimization; it must keep the same lockdown guarantees.
