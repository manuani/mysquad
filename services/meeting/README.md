# @voai/meeting

Meeting Service.

Meeting lifecycle, real-time pipeline coordination (LiveKit/STT/TTS), transcript persistence, end-of-meeting hooks. Owns the meeting state machine.

## Sprint reference

Phase 2 — Single-Agent Meeting (Sprints 2.1-2.3)

## Module contract

This service exports a `ModuleDefinition` (from `@voai/types`). The API
gateway registers it at boot. Other services that need to call this one import
the typed service from `@voai/meeting` — never reach into internal files.

## Status

Skeleton only. See `src/index.ts` for the placeholder handler and
`tests/smoke.test.ts` for the registration contract test.
