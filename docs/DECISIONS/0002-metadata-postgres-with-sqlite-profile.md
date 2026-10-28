# 0002 — PostgreSQL metadata, with a SQLite single-user profile

**Status:** accepted (2026-10-28)

**Context.** The spec makes PostgreSQL the primary metadata store. The development machine had
no PostgreSQL or Docker, and local-first users benefit from a zero-dependency mode.

**Decision.** Write portable SQLAlchemy models and Alembic migrations (naming convention,
`JSON`→`JSONB` variant, batch mode on SQLite). The default URL is a SQLite file. PostgreSQL is
selected by `AETHER_DATABASE_URL` and used by docker-compose. The test suite runs on either
(`AETHER_TEST_DATABASE_URL`).

**Verification.** The full suite passed on PostgreSQL 16 (provisioned locally from the
`pgserver` wheel, including backup via pg_dump/pg_restore) and on SQLite. The Docker stack runs
PostgreSQL 17 (matching the image's pg client) and passes the e2e suite plus a restore drill.

**Consequences.** No PostgreSQL-only features (e.g. `SKIP LOCKED`) are required; job claiming uses
an atomic conditional UPDATE that is correct on both. FK semantics differ subtly (RESTRICT is
immediate in PostgreSQL), so NO ACTION is used where deferred checking is needed (see DATABASE.md).
