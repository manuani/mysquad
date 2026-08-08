-- Migration 0011: add stripe_customer_id to tenants
-- Populated when tenant subscribes via POST /v1/metering/billing/customer.
-- Null until tenant initiates checkout; billing still works in stub mode.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
