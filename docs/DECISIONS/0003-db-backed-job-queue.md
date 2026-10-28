# 0003 — Database-backed job queue instead of RQ/Redis

**Status:** accepted (2026-10-28)

**Context.** Imports and profiling must survive API restarts. Redis was not available, and adding
it would be a second required service for a local-first app.

**Decision.** `jobs` table rows are the queue. Workers claim with
`UPDATE jobs SET status='running' … WHERE id=? AND status='pending'` (rowcount 1 = claimed),
heartbeat while running, and check `cancel_requested` at checkpoints. Stale running jobs are
re-queued up to 3 attempts. Modes: embedded thread, external process, or inline (tests).

**Consequences.** Durable, observable (the UI reads the same table), and dependency-free.
Throughput is bounded by DB polling (1 s default). That's ample for analytics jobs, but not a
general message bus. Handlers must be idempotent per attempt; imports write versioned files
atomically.
