-- Migration 0010: add plan and status columns to identity_tenants
-- Used by admin console for subscription tier tracking and tenant lifecycle.

ALTER TABLE identity_tenants
  ADD COLUMN IF NOT EXISTS plan   TEXT NOT NULL DEFAULT 'starter'
    CHECK (plan IN ('starter', 'growth', 'enterprise')),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'cancelled'));
