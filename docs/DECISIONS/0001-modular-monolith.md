# 0001 — Modular monolith

**Status:** accepted (2026-10-28)

**Context.** The product needs ingestion, SQL, profiling, dashboards and background jobs, and
it runs locally for one user or a small team. Microservices would add network boundaries,
deployment complexity and failure modes, with no demonstrated scaling need.

**Decision.** One FastAPI application with strict internal modules (`api` → `services` →
`analytics`/`ingestion`/`workers`). Expensive work runs in workers that share the same code and
database. Workers can run in-process or as separate processes.

**Consequences.** Simple local install (`aether serve`). Module boundaries keep extraction possible
later. Horizontal API scaling needs a shared rate-limit store (documented).
