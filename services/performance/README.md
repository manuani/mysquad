# @voai/performance

Performance Service.

Captures the six performance signals per contribution (factual grounding, peer agreement, expert agreement, founder action, outcome, pushback). Drives the weekly evaluation cycle.

## Sprint reference

Phase 5, Sprint 5.3

## Module contract

This service exports a `ModuleDefinition` (from `@voai/types`). The API
gateway registers it at boot. Other services that need to call this one import
the typed service from `@voai/performance` — never reach into internal files.

## Status

Skeleton only. See `src/index.ts` for the placeholder handler and
`tests/smoke.test.ts` for the registration contract test.
