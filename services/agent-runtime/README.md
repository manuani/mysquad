# @voai/agent-runtime

Agent Runtime.

Persona loading, contribution generation, sub-agent dispatch (brain retriever, calculator, document analyst, web search), scoped-context invocation for marketplace specialists. Calls Routing Service for every LLM dispatch.

## Sprint reference

Phase 2, Sprint 2.1.1; Phase 4, Sprints 4.2-4.3

## Module contract

This service exports a `ModuleDefinition` (from `@voai/types`). The API
gateway registers it at boot. Other services that need to call this one import
the typed service from `@voai/agent-runtime` — never reach into internal files.

## What's implemented

Beyond the Deliverable 2.1.1 single-agent baseline, this also includes a
deliberately-simplified showcase of the multi-agent claim (see below) —
real product content (three personas, brain continuity), not the Phase 4
hand-raise/orchestration pipeline (ADR 011), which has not been built.

- **Personas** (`src/personas/`):
  - `sarah-cfo.ts` — Sarah Chen, CFO: "warm and measured" (Strategic
    Vision §6.3), financial strategy/fundraising/runway (Platform Spec
    §5.1).
  - `priya-cmo.ts` — Priya Reddy, CMO: "sharp and direct", marketing
    strategy/positioning/acquisition.
  - `marcus-devils-advocate.ts` — Marcus Webb, Devil's Advocate: "probing
    and a little disagreeable", a structural counterweight role (not a
    domain specialty) that challenges assumptions across any topic.
  - Dispatch policy, conviction calibration, and the competence model
    from Platform Specification §6.3 are later-phase scope and not
    modeled for any persona here.
- **`AgentRuntime`** (`src/agent-runtime.ts`):
  - `generateContribution(tenantContext, persona, input)` — takes
    `tenantContext` (ADR 007, first parameter), assembles the persona's
    system prompt (plus brain context and teammate names, see below) and
    conversation history into a routing request, calls `@voai/routing`'s
    `RoutingService.complete()`, returns a structured `AgentContribution`.
  - `generateRosterContributions(tenantContext, personas, input)` —
    dispatches the same input to multiple personas **in parallel**
    (`Promise.allSettled`, so one agent's provider error doesn't block
    the others) and returns every contribution. This is the smallest unit
    of proof for the Strategic Vision's claim that this is "a meeting
    with a team," not a single chatbot — explicitly NOT the ADR 011
    hand-raise/collision-arbiter pipeline. Each persona is told the real
    names/roles of its teammates (excluding itself) so it defers to the
    correct person by name instead of inventing one — found and fixed
    after live-stack testing showed Sarah deferring to invented
    teammates "Maya (CMO)" and "Raj (COO)."
- **Brain continuity** (`src/brain-context.ts`) — `fetchBrainContextForMessage`
  calls `@voai/brain`'s typed exports (never reaches into brain's
  internals) to fetch relevant business context and inject it into the
  system prompt, so an agent's response is demonstrably continuous
  across sessions (Strategic Vision §3.2: "a colleague who remembers",
  not "a clever toy"). Two-step: extract a few distinctive keywords from
  the founder's message (the raw message can't be passed directly to
  `searchBrainContent` — its `ILIKE` is a literal substring match, so a
  full sentence essentially never matches real content) and search by
  keyword; falls back to the most recently updated items across all eight
  domains if no keyword matches, so a new or unmatched query still gets
  *some* business context rather than none.
- **HTTP routes** (`src/routes.ts`), header-based tenant-context pattern
  matching `services/brain/src/routes.ts` (no gateway auth middleware
  yet):
  - `POST /v1/agent-runtime/contributions` — single-agent (Sarah), with
    brain context.
  - `POST /v1/agent-runtime/contributions/roster` — the full
    three-persona roster in parallel, with brain context and
    teammate-awareness for every persona.
  - Unexpected errors are logged via the module's `Logger` before the 500
    response — never a silent catch.
- **Cross-module calls** — `@voai/routing`'s typed exports
  (`RoutingService`, `AnthropicProvider`, `LlmMessage`) and `@voai/brain`'s
  typed exports (`searchBrainContent`, `listBrainContentByDomain`,
  `BRAIN_DOMAINS`), never by reaching into either module's internals
  (CLAUDE.md "Module boundaries are real").
- **Tests** (`tests/`): `agent-runtime.test.ts` (system-prompt assembly,
  brain-context injection, teammate-awareness, parallel roster dispatch
  and per-agent failure isolation), `brain-context.test.ts`
  (keyword-match vs. recency-fallback logic), `routes.test.ts` (both
  HTTP routes, validation, tenant-context errors, error logging),
  `smoke.test.ts`.

## Deferred / stubbed

- **No ADR 011 hand-raise/collision-arbiter pipeline.** The roster
  endpoint above is a deliberately simplified showcase of the multi-agent
  claim — real persona content, real parallel dispatch — not the Phase 4
  orchestration design (parallel observation, collision-gated LLM
  arbiter, founder-facing hand-raise queue). Building that should not
  require reshaping `AgentContribution` or `generateContribution`'s
  signature.
- **No real Anthropic response can be exercised without a configured
  `ANTHROPIC_API_KEY`.** When one is configured, both endpoints make real
  calls; verified live against the deployed stack with seeded brain
  content (three personas independently producing distinct, persona-
  consistent responses that reference seeded business facts without
  being told them directly in the request).
- **Only three personas.** The real default roster (5-7 agents,
  stage-and-industry adapted per Platform Specification §5.1) and
  per-tenant persona customization are out of scope here.

## Status

Single-agent baseline (Deliverable 2.1.1) plus a showcase extension:
multi-persona parallel dispatch, brain continuity, and teammate-awareness.
See `src/personas/`, `src/agent-runtime.ts`, `src/brain-context.ts`,
`src/routes.ts`, `src/index.ts`, and `tests/` for the implementation and
coverage.
