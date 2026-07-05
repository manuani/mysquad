-- Migration 0013: add active flag to users table
-- Supports admin deactivation (suspending access without deleting the row).
-- Defaults to true so existing rows are unaffected.

ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS users_tenant_active_idx ON users (tenant_id, active);
