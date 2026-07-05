# @voai/ledger

Ledger Service.

Decisions, actions, conflicts, with rationale and history. Seven action
lifecycle states (Pending, In Progress, Completed, Cancelled, Blocked,
Snoozed, Delegated_to_expert). Four decision states (Active, Superseded,
Abandoned, Draft). Four-button conflict resolution (Refines, Replaces,
Parallel, Abandons).

## Sprint reference

Phase 3, Sprint 3.2, Deliverable 3.2.1 (Ledger schema and lifecycle).

## Module contract

This service exports a `ModuleDefinition` (from `@voai/types`). The API
gateway registers it at boot. Other services that need to call this one import
the typed service from `@voai/ledger` — never reach into internal files.

## Status

**Implemented** (this deliverable):

- Postgres schema for `decisions`, `actions`, `conflicts`
  (`packages/db/migrations/1750000000003_ledger.sql`), with row-level
  security (`ENABLE` + `FORCE`, per ADR 010) and CHECK constraints on every
  state enum.
- CRUD + state-transition operations for all three entities, going through
  `db.postgres.withTenant` (never a raw query) and taking `tenantContext:
TenantContext` as the first parameter on every tenant-scoped function
  (ADR 007). Application code enforces valid state-machine transitions
  (e.g. a Completed action cannot return to Pending) on top of the DB
  CHECK constraints.
- The four-button conflict-resolution flow (Refines/Replaces/Parallel/
  Abandons) as an explicit operation (`supersedeDecision` in
  `src/decisions.ts`), not a raw state update.
- A "currently active" aggregate query (`getCurrentlyActive` in
  `src/currently-active.ts`) composing pending/in-progress actions,
  outcome-due decisions, and unresolved conflicts — implemented as a query
  over existing tables, not a separate table, per the Platform
  Specification.
- HTTP routes: `POST /decisions`, `PATCH /decisions/:id/supersede`, `PATCH
/decisions/:id/outcome`, `POST /actions`, `PATCH /actions/:id/state`,
  `POST /conflicts`, `POST /conflicts/:id/resolve`, `GET
/currently-active`.

**Deferred** (out of scope for this deliverable):

- End-of-meeting extraction with the three confirmation tiers (routine,
  substantive, high-stakes) — this depends on `services/meeting`, which
  does not exist yet. The decision/action creation routes here accept
  direct API input; meeting-derived extraction is a separate, later
  integration.
- `Delegated_to_team_member` action state — explicitly deferred to v2 per
  the Platform Specification.
- Decay-flagged items in the "currently active" view — decay detection
  depends on the Brain Service's contradiction/staleness analysis (built
  concurrently in `services/brain`).
- Mobile ledger UI — a client-surface concern, not part of this module.
- Authentication of the caller — routes here read tenant context from
  headers the API gateway is expected to attach after resolving the
  caller's session via identity-and-tenancy; this module does not
  authenticate sessions itself.
