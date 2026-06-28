# @voai/agent-runtime

Agent Runtime.

Persona loading, contribution generation, sub-agent dispatch (brain retriever, calculator, document analyst, web search), scoped-context invocation for marketplace specialists. Calls Routing Service for every LLM dispatch.

## Sprint reference

Phase 2, Sprint 2.1.1; Phase 4, Sprints 4.2-4.3

## Module contract

This service exports a `ModuleDefinition` (from `@voai/types`). The API
gateway registers it at boot. Other services that need to call this one import
the typed service from `@voai/agent-runtime` — never reach into internal files.

## What's implemented (this deliverable — Sprint Plan 2.1.1)

**Single-agent only.** This deliverable is scoped to exactly one agent
persona and one LLM call path. It does not build multi-agent
orchestration, the hand-raise protocol, sub-agent dispatch (brain
retriever, calculator, document analyst, web search), or any
LangGraph/state-machine orchestration framework — that decision belongs to
Phase 4 (multi-agent meetings, Sprints 4.2-4.3) and has not been made yet.

- **Persona** (`src/personas/sarah-cfo.ts`) — Sarah Chen, CFO: name, role,
  tone ("warm and measured", per Strategic Vision §6.3), and a real system
  prompt establishing her domain (financial strategy, fundraising, unit
  economics, runway, per Platform Specification §5.1) and communication
  style. Dispatch policy, conviction calibration, and the competence model
  from Platform Specification §6.3 are later-phase scope and not modeled
  here.
- **`AgentRuntime`** (`src/agent-runtime.ts`) — takes `tenantContext`
  (ADR 007, first parameter), a persona, and `{ message, priorTurns? }`;
  assembles the persona's system prompt and conversation history into a
  routing request, calls `@voai/routing`'s `RoutingService.complete()`,
  and returns a structured `AgentContribution`
  (`{ agentName, content, generatedAt }`). This is the seam multi-agent
  dispatch builds on top of later — kept single-purpose now.
- **HTTP route** — `POST /v1/agent-runtime/contributions`
  (`src/routes.ts`), built on the same header-based tenant-context
  pattern as `services/brain/src/routes.ts` (`x-tenant-id` / `x-user-id`
  / `x-user-type` / `x-session-id`), since there is no gateway auth
  middleware yet. Accepts `{ message: string }`, invokes Sarah's persona
  through `RoutingService`, and returns her contribution. Unexpected
  errors are logged via the module's `Logger` before the 500 response is
  sent — never a silent catch.
- **Cross-module call** — goes through `@voai/routing`'s typed exports
  (`RoutingService`, `AnthropicProvider`, `LlmMessage`), never by reaching
  into `services/routing/src` internals (CLAUDE.md "Module boundaries are
  real"). `src/index.ts` constructs its own `RoutingService` instance from
  the same `PlatformConfig.anthropicApiKey` routing's own module uses,
  since there is no in-process module registry yet for one module to look
  up another's already-constructed service by name.
- **Tests** (`tests/`):
  - `agent-runtime.test.ts` — unit tests against a fake `RoutingService`;
    covers system-prompt assembly, conversation-history ordering,
    `tenantContext` threading, and the `AgentContribution` shape. No real
    network/LLM calls.
  - `routes.test.ts` — boots a real `http.Server` (matching
    `services/ledger/tests/routes.test.ts`'s pattern) against a fake
    `RoutingService`; covers the happy path, validation errors, missing
    tenant headers, and that unexpected routing errors are logged (not
    silently swallowed) before the 500 response.
  - `smoke.test.ts` — pre-existing module-registration contract test.

## Deferred / stubbed

- **No multi-agent orchestration, hand-raise protocol, or sub-agent
  dispatch.** Explicitly Phase 4 (Sprints 4.2-4.3) scope, depending on an
  orchestration-framework decision (e.g. LangGraph vs. custom
  state-machine) that has not been made. Adding it should not require
  reshaping `AgentContribution` or `AgentRuntime.generateContribution`'s
  signature — that's the point of keeping this seam single-purpose now.
- **No real Anthropic response can be exercised in this environment.**
  There is no real `ANTHROPIC_API_KEY` configured. This matches routing's
  own documented gap (`services/routing/README.md` "Deferred"): a `curl`
  against a booted `apps/api-server` reaches routing's
  `PROVIDER_UNAVAILABLE` (503) cleanly rather than completing a real call
  or crashing — confirmed as part of this deliverable's verification.
- **Only one persona.** Other agents (e.g. a CTO, COO) and per-tenant
  persona customization (founders renaming Sarah, but not changing her
  underlying persona, per Platform Specification §6.3) are out of scope
  here.

## Status

Single-agent persona, runtime, and HTTP route implemented per Deliverable
2.1.1. See `src/personas/sarah-cfo.ts` for the persona, `src/agent-runtime.ts`
for the runtime, `src/routes.ts` for the HTTP surface, `src/index.ts` for
module registration, and `tests/` for coverage.
