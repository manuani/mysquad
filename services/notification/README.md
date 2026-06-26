# @voai/notification

Notification Service.

Morning briefings, alerts, email/push delivery, hand-raise notifications. Scheduled (briefings) and event-driven (alerts on risk/decision/conflict surfacing).

## Sprint reference

Phase 4 onwards

## Module contract

This service exports a `ModuleDefinition` (from `@voai/types`). The API
gateway registers it at boot. Other services that need to call this one import
the typed service from `@voai/notification` — never reach into internal files.

## Status

Skeleton only. See `src/index.ts` for the placeholder handler and
`tests/smoke.test.ts` for the registration contract test.
