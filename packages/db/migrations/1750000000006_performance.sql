-- Up Migration
--
-- Performance Service schema (Sprint 5.3). Stores the six signal types
-- (factual_grounding, peer_agreement, expert_agreement, founder_action,
-- outcome, pushback) emitted per persona contribution. Each signal carries a
-- 0-1 normalised value and who recorded it (system, founder, or expert).
--
-- RLS pattern: ENABLE alone is not enough — the migration runner owns the
-- table, and Postgres exempts table owners from RLS by default. FORCE closes
-- that gap (same reasoning as decisions/actions/conflicts — see
-- 1750000000003_ledger.sql and ADR 010).

CREATE TABLE performance_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  session_id UUID,
  transcript_entry_id UUID,
  persona_id TEXT NOT NULL,
  signal_type TEXT NOT NULL CHECK (signal_type IN (
    'factual_grounding',
    'peer_agreement',
    'expert_agreement',
    'founder_action',
    'outcome',
    'pushback'
  )),
  value REAL NOT NULL CHECK (value >= 0 AND value <= 1),
  recorded_by TEXT NOT NULL CHECK (recorded_by IN ('system', 'founder', 'expert')),
  notes TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE performance_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_signals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON performance_signals
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE INDEX performance_signals_tenant_persona_idx
  ON performance_signals (tenant_id, persona_id, recorded_at);

CREATE INDEX performance_signals_tenant_recorded_at_idx
  ON performance_signals (tenant_id, recorded_at);

-- Down Migration

DROP TABLE IF EXISTS performance_signals;
