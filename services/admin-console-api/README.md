# @voai/admin-console-api

Admin Console API.

Operations team endpoints serving the Admin Console web app. Three role groups (Operations, Customer Success, Trust & Safety). Audit logging on every action. Consent-gated founder support access.

## Sprint reference

Phase 7, Sprints 7.1-7.3; System Architecture v2 §6

## Module contract

This service exports a `ModuleDefinition` (from `@voai/types`). The API
gateway registers it at boot. Other services that need to call this one import
the typed service from `@voai/admin-console-api` — never reach into internal files.

## Status

Skeleton only. See `src/index.ts` for the placeholder handler and
`tests/smoke.test.ts` for the registration contract test.
