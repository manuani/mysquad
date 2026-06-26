# @voai/identity-and-tenancy

Identity and Tenancy Service.

Per System Architecture §3.1, §3.4.1, §3.5, and §8.1.1, Identity and
Tenancy is treated as one component, not two. This module merges what was
previously `services/identity` and `services/tenancy` (verification
backlog Issue 1; see `docs/adr/008-merge-identity-and-tenancy.md`,
superseding ADR 004's twelve-module list).

WorkOS-backed authentication: Apple, Google, Microsoft, and email
magic-link sign-in flows. Issues session tokens that authenticate API
calls and carry tenant context. Owns the tenant model and enforces
multi-tenant isolation — row-level security in Postgres, and the boundary
that makes cross-tenant access unrepresentable through any API path.

## Sprint reference

Phase 1, Sprint 1.2 — Identity and authentication
Phase 1, Sprint 1.2.2 — Tenant model and enforcement

## Module contract

This service exports a `ModuleDefinition` (from `@voai/types`). The API
gateway registers it at boot. Other services that need to call this one
import the typed service from `@voai/identity-and-tenancy` — never reach
into internal files.

## Status

Skeleton only. See `src/index.ts` for the placeholder handler and
`tests/smoke.test.ts` for the registration contract test.
