-- Up Migration
--
-- Notification Service schema (Phase 4): notification_preferences table.
-- One row per tenant storing morning briefing schedule and alert opt-ins.
-- Same RLS pattern as ledger.sql: ENABLE + FORCE so the migration runner's
-- role (table owner) is also subject to RLS.

CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id),
  morning_briefing_enabled BOOLEAN NOT NULL DEFAULT true,
  briefing_hour INTEGER NOT NULL DEFAULT 8 CHECK (briefing_hour >= 0 AND briefing_hour <= 23),
  briefing_timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  alert_on_high_risk BOOLEAN NOT NULL DEFAULT true,
  alert_on_conflict BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_preferences
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Down Migration

DROP TABLE IF EXISTS notification_preferences;
