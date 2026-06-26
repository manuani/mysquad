# @voai/ledger

Ledger Service.

Decisions, actions, conflicts. Seven action lifecycle states (Pending, In Progress, Completed, Cancelled, Blocked, Snoozed, Delegated_to_expert). Four decision states. End-of-meeting extraction with three confirmation tiers (routine, substantive, high-stakes).

## Sprint reference

Phase 3, Sprints 3.2 and 3.3

## Module contract

This service exports a `ModuleDefinition` (from `@voai/types`). The API
gateway registers it at boot. Other services that need to call this one import
the typed service from `@voai/ledger` — never reach into internal files.

## Status

Skeleton only. See `src/index.ts` for the placeholder handler and
`tests/smoke.test.ts` for the registration contract test.
