-- Up Migration
--
-- Extensions needed by this migration (vector type for brain embeddings).
-- IF NOT EXISTS makes this idempotent — safe whether or not the bootstrap
-- script or local docker init already created them.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

--
-- Brain Service schema (Sprint 3.1, Deliverable 3.1.1: Brain schema and
-- storage). Per System Architecture and Platform Specification, the brain
-- captures founder knowledge across eight domains: company_profile,
-- financial_state, market_and_customers, competitive_landscape, decisions,
-- risks, goals, relationships.
--
-- Scope of this migration: backend storage only, matching the scope of the
-- accompanying @voai/brain module work (CRUD + search API, no
-- meeting-transcript extraction — that needs services/meeting, which
-- doesn't exist yet).
--
-- Storage model (simplified for v1, per the platform spec's two-form
-- content model): each brain content item is stored as a canonical record
-- in its source language (immutable; edits create a new row rather than
-- mutating the canonical text) plus an English-pivot derived form used for
-- cross-language search and display. `brain_content_canonical` holds both
-- forms on one row for v1 — `content`/`language` is the canonical
-- source-language text, `content_en` is the English-pivot derived form
-- (nullable; defaults to `content` at write time when the source language
-- is already English, populated by an extraction/translation step
-- otherwise, which is out of scope here).
--
-- `embedding vector(1536)` is included so real semantic search can be
-- wired later without another migration; the `vector` extension is already
-- enabled per docs/adr/010. v1's @voai/brain module does not populate or
-- query this column — search is ILIKE/full-text only for now (see
-- services/brain/README.md).
--
-- Same RLS pattern as baseline.sql / identity_and_tenancy.sql /
-- 1750000000003_ledger.sql: ENABLE alone is insufficient because the
-- migration runner's role owns these tables and Postgres exempts table
-- owners from RLS by default. FORCE closes that gap. See ADR 010 for why
-- this is load-bearing, not cosmetic.

CREATE TABLE brain_content_canonical (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  domain VARCHAR(32) NOT NULL CHECK (
    domain IN (
      'company_profile',
      'financial_state',
      'market_and_customers',
      'competitive_landscape',
      'decisions',
      'risks',
      'goals',
      'relationships'
    )
  ),
  language VARCHAR(8) NOT NULL,
  content TEXT NOT NULL,
  content_en TEXT,
  -- pgvector column for future semantic search (stretch goal / deferred —
  -- see services/brain/README.md). Not populated or queried by v1 code.
  embedding vector(1536),
  source VARCHAR(32) NOT NULL CHECK (
    source IN ('founder_edit', 'agent_extraction', 'integration_import')
  ),
  -- Soft delete: founders can delete items, but per the transparency
  -- requirement every change (including deletion) must remain auditable.
  -- A hard DELETE would orphan brain_content_audit's before/after trail for
  -- that item, so deletion is modeled as a tombstone instead.
  deleted_at TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX brain_content_canonical_tenant_domain_idx
  ON brain_content_canonical (tenant_id, domain)
  WHERE deleted_at IS NULL;

-- Full-text search support for v1's ILIKE/full-text search stub (see
-- services/brain/src/search.ts). GIN index over content + content_en so
-- `to_tsvector('english', ...)` queries stay reasonably fast without
-- requiring real vector similarity search.
CREATE INDEX brain_content_canonical_fts_idx
  ON brain_content_canonical
  USING gin (to_tsvector('english', coalesce(content, '') || ' ' || coalesce(content_en, '')));

ALTER TABLE brain_content_canonical ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_content_canonical FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON brain_content_canonical
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Audit trail: every change to a brain content item (founder edit, agent
-- extraction, integration import, or delete) is recorded here with
-- before/after values, per the platform's transparency requirement that
-- founders can see full history of every brain item. `item_id` is not a
-- foreign key with ON DELETE CASCADE on purpose — content rows are never
-- hard-deleted (tombstoned via `deleted_at` instead), so the audit trail
-- always has a live row to join back to.
CREATE TABLE brain_content_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  item_id UUID NOT NULL REFERENCES brain_content_canonical(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by UUID REFERENCES users(id),
  change_type VARCHAR(16) NOT NULL CHECK (change_type IN ('create', 'update', 'delete')),
  source VARCHAR(32) NOT NULL CHECK (
    source IN ('founder_edit', 'agent_extraction', 'integration_import')
  ),
  before_value JSONB,
  after_value JSONB
);

CREATE INDEX brain_content_audit_item_idx ON brain_content_audit (item_id, changed_at);

ALTER TABLE brain_content_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_content_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON brain_content_audit
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Down Migration

DROP TABLE IF EXISTS brain_content_audit;
DROP TABLE IF EXISTS brain_content_canonical;
