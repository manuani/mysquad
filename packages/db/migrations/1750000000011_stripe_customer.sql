-- Migration 0011: add stripe_customer_id to identity_tenants
-- Populated when tenant subscribes via POST /v1/metering/billing/customer.
-- Null until tenant initiates checkout; billing still works in stub mode.

ALTER TABLE identity_tenants
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
