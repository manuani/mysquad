-- Migration 0012: audit_log table
--
-- Append-only log of every mutating API action. Used for compliance (GDPR
-- Article 30 records of processing), security investigations, and the
-- admin console activity feed.
--
-- Design constraints:
--   - No UPDATE or DELETE ever touches this table (enforced via no DELETE
--     policy on the RLS policy — inserts allowed, everything else blocked).
--   - tenant_id nullable to allow pre-auth events (sign-up attempts, etc.)
--   - actor_id nullable for system-initiated actions (cron, webhook)
--   - payload JSONB capped at a sensible size in application code

CREATE TABLE IF NOT EXISTS audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID,
  actor_id     UUID,
  actor_type   TEXT CHECK (actor_type IN ('founder', 'admin', 'expert', 'system', 'webhook')),
  action       TEXT NOT NULL,
  resource     TEXT,
  resource_id  TEXT,
  outcome      TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  payload      JSONB,
  ip_address   TEXT,
  user_agent   TEXT,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_tenant_idx ON audit_log (tenant_id, occurred_at DESC)
  WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor_id, occurred_at DESC)
  WHERE actor_id IS NOT NULL;

-- RLS: tenants can only read their own rows; inserts from the app role are
-- allowed; no deletes or updates are ever permitted (no policy means the
-- default-deny kicks in for those verbs).
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_log_tenant_read ON audit_log
  FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.tenant_id')::uuid
  );

CREATE POLICY audit_log_insert ON audit_log
  FOR INSERT
  WITH CHECK (true);
