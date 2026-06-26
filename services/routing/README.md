# @voai/routing

Routing Service.

All LLM calls dispatch through here. v1 baseline: single provider (Anthropic). Phase 5 expands to four-tier classification (Advanced/High/Good/OpenSource) across 5-7 providers with subscription-tier-driven routing and failover.

## Sprint reference

Phase 2, Sprint 2.1.2; Phase 5, Sprint 5.1

## Module contract

This service exports a `ModuleDefinition` (from `@voai/types`). The API
gateway registers it at boot. Other services that need to call this one import
the typed service from `@voai/routing` — never reach into internal files.

## Status

Skeleton only. See `src/index.ts` for the placeholder handler and
`tests/smoke.test.ts` for the registration contract test.
