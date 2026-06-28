# @voai/brain

Brain Service.

The eight knowledge domains — Company profile, Financial state, Market and
customers, Competitive landscape, Decisions, Risks, Goals, Relationships —
stored across Postgres (structured), pgvector (semantic), and Neo4j
(relationship graph). Ingestion from sessions, documents, integrations.
Three query modes: semantic retrieval, structured metric, real-time
contradiction check (P95 brain query target < 800ms).

## Sprint reference

Phase 3, Sprint 3.1 — Brain capture and storage (Deliverable 3.1.1: Brain
schema and storage).

## Module contract

This service exports a `ModuleDefinition` (from `@voai/types`). The API
gateway registers it at boot. Other services that need to call this one import
the typed service from `@voai/brain` — never reach into internal files.

## What's implemented (this deliverable)

- **Schema** (`packages/db/migrations/1750000000002_brain.sql`):
  - `brain_content_canonical` — one row per brain content item, scoped by
    `domain` (CHECK-constrained to the eight domain names) and tenant.
    Holds the canonical source-language `content` plus an `content_en`
    English-pivot column for the two-form storage model described in the
    platform spec. Includes an `embedding vector(1536)` column for future
    semantic search (see "Deferred" below — unused by this deliverable's
    code). Soft-deleted via `deleted_at` rather than hard `DELETE`, so the
    audit trail always has a row to join back to.
  - `brain_content_audit` — append-only history of every create/update/
    delete on a content item: timestamp, actor (`changed_by`), `source`
    (`founder_edit` / `agent_extraction` / `integration_import`), and full
    `before_value`/`after_value` JSON snapshots. This is what satisfies the
    "founders can view full audit history of every item" requirement.
  - Both tables have `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL
    SECURITY` + a `tenant_isolation` policy, matching the baseline
    migration's pattern exactly (see ADR 010 for why `FORCE` is
    load-bearing).
- **CRUD + search** (`src/content-store.ts`): `createBrainContentItem`,
  `listBrainContentByDomain`, `getBrainContentItem`,
  `updateBrainContentItem` (writes an audit row with before/after),
  `deleteBrainContentItem` (soft delete + audit row), `searchBrainContent`,
  `getBrainContentHistory`. Every function takes `tenantContext:
  TenantContext` as its first parameter (ADR 007) and goes through
  `postgres.withTenant(...)` — no raw queries.
- **HTTP routes** (`src/routes.ts`), mounted at the module's router root
  (gateway mounts the module at `/v1/brain`):
  - `GET /domains/:domain` — list non-deleted items in a domain
  - `POST /domains/:domain` — create an item
  - `GET /items/:id` — fetch one item
  - `PATCH /items/:id` — update an item (audited)
  - `DELETE /items/:id` — soft-delete an item (audited)
  - `GET /items/:id/history` — full audit history for one item
  - `GET /search?q=...` — ILIKE search over `content`/`content_en`
- **Tests** (`tests/content-store.test.ts`): unit tests against an
  in-memory fake `PostgresClient` (same pattern as
  `services/identity-and-tenancy/tests/dev-auth-provider.test.ts`), plus the
  existing `tests/smoke.test.ts` module-registration check.

## Deferred / stubbed

- **Vector search is stubbed.** `embedding vector(1536)` exists on
  `brain_content_canonical` and the `vector` extension is enabled, but
  nothing in this deliverable populates or queries it. `searchBrainContent`
  is ILIKE-only (backed by a GIN full-text index for headroom). Wiring real
  embedding generation + pgvector similarity search is follow-on work.
- **Meeting-transcript extraction is out of scope.** Ingesting brain
  content from meeting transcripts requires `services/meeting`, which does
  not exist yet. `source: 'agent_extraction'` is modeled in the schema and
  accepted by the API, but nothing currently produces it automatically.
- **Neo4j relationship graph is deferred.** The `relationships` domain is
  stored as plain structured content rows like every other domain; no graph
  traversal or Neo4j wiring was attempted in this deliverable (optional/
  stretch per the task scope).
- **Mobile/founder-facing UI is out of scope** for this deliverable —
  backend storage + CRUD API only.
- **Tenant-context resolution from HTTP requests is a placeholder.**
  `routes.ts` builds `TenantContext` from `x-tenant-id` / `x-user-id` /
  `x-user-type` / `x-session-id` headers rather than a session token,
  matching the stage at which a shared gateway-level session-to-context
  middleware doesn't yet exist. Replace with the real bridge once the
  gateway has one (likely alongside `identity-and-tenancy`'s `/me`
  endpoint).

## Status

Backend storage + CRUD/search API implemented per Deliverable 3.1.1. See
`src/index.ts` for the module registration, `src/content-store.ts` for
persistence, `src/routes.ts` for the HTTP surface, and
`tests/content-store.test.ts` / `tests/smoke.test.ts` for tests.
