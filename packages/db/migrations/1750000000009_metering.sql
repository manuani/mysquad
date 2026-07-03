-- Migration 0009: usage metering tables
-- Records LLM token consumption and expert session minutes per tenant.
-- These rows drive Stripe metered billing and the admin usage dashboard.

-- ── metering_events ──────────────────────────────────────────────────────────────
-- One row per billable event. event_type values:
--   llm_tokens       — LLM API call (input + output tokens)
--   expert_minutes   — expert session duration in minutes
--   ai_roster_call   — single roster call (flat rate, not token-priced)
CREATE TABLE IF NOT EXISTS metering_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  session_id      UUID,              -- meeting session that incurred the cost (nullable)
  event_type      TEXT NOT NULL CHECK (event_type IN ('llm_tokens', 'expert_minutes', 'ai_roster_call')),
  quantity        DOUBLE PRECISION NOT NULL,   -- tokens, minutes, or call count
  model           TEXT,              -- LLM model name (for llm_tokens events)
  unit_cost_micro BIGINT NOT NULL DEFAULT 0,   -- USD × 10^-6 per unit
  total_cost_micro BIGINT NOT NULL DEFAULT 0,  -- quantity × unit_cost_micro
  metadata        JSONB,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS metering_events_tenant_idx ON metering_events(tenant_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS metering_events_session_idx ON metering_events(session_id) WHERE session_id IS NOT NULL;

-- ── monthly_usage_rollup ─────────────────────────────────────────────────────────
-- Pre-aggregated monthly totals per tenant. Populated by the metering-rollup
-- scheduler job (0 * * * *). Used by the admin console dashboard.
CREATE TABLE IF NOT EXISTS monthly_usage_rollup (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  period_year         SMALLINT NOT NULL,
  period_month        SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  total_input_tokens  BIGINT NOT NULL DEFAULT 0,
  total_output_tokens BIGINT NOT NULL DEFAULT 0,
  total_expert_minutes DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_roster_calls  BIGINT NOT NULL DEFAULT 0,
  total_cost_micro    BIGINT NOT NULL DEFAULT 0,   -- USD × 10^-6
  stripe_invoice_id   TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period_year, period_month)
);

CREATE INDEX IF NOT EXISTS monthly_rollup_tenant_idx ON monthly_usage_rollup(tenant_id, period_year DESC, period_month DESC);
