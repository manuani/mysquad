# @voai/marketplace-metering

Marketplace Metering Service.

Sub-component of Marketplace. Emits meter events for the four billing models (per-month, per-use, per-token, per-day). Aggregates per founder per agent per billing period. Stripe metered billing for invoicing.

## Sprint reference

Phase 6, Sprint 6.1; System Architecture v2 §2.2

## Module contract

This service exports a `ModuleDefinition` (from `@voai/types`). The API
gateway registers it at boot. Other services that need to call this one import
the typed service from `@voai/marketplace-metering` — never reach into internal files.

## Status

Skeleton only. See `src/index.ts` for the placeholder handler and
`tests/smoke.test.ts` for the registration contract test.
