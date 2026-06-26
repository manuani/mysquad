# @voai/tenancy

Tenancy Service.

Tenant model and multi-tenant isolation. Enforces row-level security in Postgres and propagates tenant context to every downstream call. Boundary tests in Sprint 1.2.2 verify cross-tenant access is blocked at all layers.

## Sprint reference

Phase 1, Sprint 1.2.2 — Tenant model and enforcement

## Module contract

This service exports a `ModuleDefinition` (from `@voai/types`). The API
gateway registers it at boot. Other services that need to call this one import
the typed service from `@voai/tenancy` — never reach into internal files.

## Status

Skeleton only. See `src/index.ts` for the placeholder handler and
`tests/smoke.test.ts` for the registration contract test.
