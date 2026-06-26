# @voai/agent-runtime

Agent Runtime.

Persona loading, contribution generation, sub-agent dispatch (brain retriever, calculator, document analyst, web search), scoped-context invocation for marketplace specialists. Calls Routing Service for every LLM dispatch.

## Sprint reference

Phase 2, Sprint 2.1.1; Phase 4, Sprints 4.2-4.3

## Module contract

This service exports a `ModuleDefinition` (from `@voai/types`). The API
gateway registers it at boot. Other services that need to call this one import
the typed service from `@voai/agent-runtime` — never reach into internal files.

## Status

Skeleton only. See `src/index.ts` for the placeholder handler and
`tests/smoke.test.ts` for the registration contract test.
