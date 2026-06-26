# @voai/identity

Identity Service.

WorkOS-backed authentication. Apple, Google, Microsoft, and email magic-link sign-in flows. Issues session tokens that authenticate API calls and carry tenant context.

## Sprint reference

Phase 1, Sprint 1.2 — Identity and authentication

## Module contract

This service exports a `ModuleDefinition` (from `@voai/types`). The API
gateway registers it at boot. Other services that need to call this one import
the typed service from `@voai/identity` — never reach into internal files.

## Status

Skeleton only. See `src/index.ts` for the placeholder handler and
`tests/smoke.test.ts` for the registration contract test.
