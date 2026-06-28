-- Up Migration
--
-- Meeting Service schema (Sprint 2.3, Deliverable 2.3.2: End-to-end meeting
-- flow). Extends the baseline `sessions` table (which already has RLS
-- enabled/forced and a tenant_isolation policy from 1750000000000_baseline.sql
-- — this migration only ALTERs it, it does not duplicate ENABLE/FORCE/POLICY)
-- and adds `transcript_entries` for the sequence of what was said in a
-- meeting, attributed to founder or agent, in order.
--
-- Scope of this migration: backend persistence for the typed-mode meeting
-- lifecycle only (started -> active -> ended). Voice/mixed modes and
-- real-time pipeline coordination (LiveKit/STT/TTS) are deferred — `mode`
-- is modeled now so the column doesn't need a later migration, but only
-- 'typed' is actually usable until that infra lands.

ALTER TABLE sessions
  ADD COLUMN status TEXT NOT NULL DEFAULT 'started'
    CHECK (status IN ('started', 'active', 'ended')),
  ADD COLUMN mode TEXT NOT NULL DEFAULT 'typed'
    CHECK (mode IN ('typed', 'voice', 'mixed')),
  ADD COLUMN ended_at TIMESTAMPTZ;

-- Transcript entries: the ordered sequence of turns in a meeting, each
-- attributed to the founder or an agent. `sequence_number` is the
-- authoritative ordering (monotonically increasing per session, assigned in
-- application code inside the same withTenant transaction as the insert) —
-- `created_at` alone is not reliable enough for ordering for entries that
-- could land in the same millisecond.
CREATE TABLE transcript_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  session_id UUID NOT NULL REFERENCES sessions(id),
  sequence_number INTEGER NOT NULL,
  speaker_type TEXT NOT NULL CHECK (speaker_type IN ('founder', 'agent')),
  speaker_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, sequence_number)
);

-- Same pattern as every other tenant-scoped table (see baseline.sql):
-- ENABLE alone is insufficient because the migration runner's role owns
-- this table and Postgres exempts table owners from RLS by default. FORCE
-- closes that gap. See ADR 010.
ALTER TABLE transcript_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcript_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transcript_entries
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE INDEX sessions_tenant_status_idx ON sessions (tenant_id, status);
CREATE INDEX transcript_entries_session_seq_idx ON transcript_entries (session_id, sequence_number);

-- Down Migration

DROP TABLE IF EXISTS transcript_entries;
DROP INDEX IF EXISTS sessions_tenant_status_idx;
ALTER TABLE sessions
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS mode,
  DROP COLUMN IF EXISTS ended_at;
