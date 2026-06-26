# @voai/marketplace

Marketplace Service.

Three-layer expertise stack: default roster agents (subscription-gated), marketplace specialist agents (loaded on-demand with scoped context, four billing models), human experts (closed network at v1 with three engagement models). Hire/fire flows. Multi-dimensional ratings.

## Sprint reference

Phase 6, Sprints 6.1-6.3

## Module contract

This service exports a `ModuleDefinition` (from `@voai/types`). The API
gateway registers it at boot. Other services that need to call this one import
the typed service from `@voai/marketplace` — never reach into internal files.

## Status

Skeleton only. See `src/index.ts` for the placeholder handler and
`tests/smoke.test.ts` for the registration contract test.
