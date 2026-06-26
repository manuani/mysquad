-- Runs once, on first container boot, before any application migration.
-- node-pg-migrate manages everything after this point (see
-- packages/db/migrations/ and docs/adr/010-node-pg-migrate.md) — this file
-- only handles what must exist before migrations can run: the extension
-- the baseline schema's vector columns depend on.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()
