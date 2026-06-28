# @voai/routing

Routing Service.

All LLM calls dispatch through here. v1 baseline: single provider
(Anthropic). Phase 5 expands to four-tier classification
(Advanced/High/Good/OpenSource) across 5-7 providers with
subscription-tier-driven routing and failover.

## Sprint reference

Phase 2, Sprint 2.1.2 (Routing layer skeleton); Phase 5, Sprint 5.1
(multi-provider routing, four-tier classification).

## Module contract

This service exports a `ModuleDefinition` (from `@voai/types`). The API
gateway registers it at boot. Other services that need to call this one
import the typed service from `@voai/routing` — never reach into internal
files.

## What's implemented (this deliverable)

- **`LlmProvider` interface** (`src/provider.ts`) — the seam every concrete
  provider implements: `complete(request) => Promise<LlmCompletionResult>`.
  `RoutingService` depends only on this interface, never on a concrete
  provider class, so adding a second provider is a registration/config
  change in `src/index.ts`, not a change to `RoutingService` or any call
  site. This satisfies Deliverable 2.1.2's definition of done: "Switching
  providers requires only configuration change, no code change."
- **`AnthropicProvider`** (`src/anthropic-provider.ts`) — the v1 baseline
  implementation, using the official `@anthropic-ai/sdk`. Reads its API key
  from `ModuleContext.config.anthropicApiKey` (via `@voai/config`'s
  `PlatformConfig`), passed in at construction — never from `process.env`
  directly. If no API key is configured, `complete()` throws a
  `PlatformError('PROVIDER_UNAVAILABLE', 503, ...)` the first time it is
  actually invoked; the module still registers and reports healthy at boot
  with no key configured (mirrors how `identity-and-tenancy` documented its
  missing-WorkOS-credentials gap rather than failing at boot).
- **`RoutingService`** (`src/routing-service.ts`) — takes `tenantContext:
  TenantContext` first (ADR 007), logs the routing decision and the
  completion outcome (success or failure) via the module's `Logger`, then
  dispatches to the single configured provider. No `routing_decisions`
  table exists yet — persisting routing decisions has billing implications
  (cost/usage tracking) and is left to a later sprint with a clear
  migration owner; for v1 the decision record is the structured log line
  only.
- **HTTP route** — `POST /v1/routing/complete` (`src/routes.ts`), built on
  the same header-based tenant-context-resolution pattern as
  `services/brain/src/routes.ts` (`x-tenant-id` / `x-user-id` /
  `x-user-type` / `x-session-id`), since there is no gateway auth
  middleware yet. Validates `systemPrompt` (string) and `messages`
  (non-empty array of `{ role: 'user'|'assistant', content: string }`),
  with optional `maxTokens`.
- **Typed cross-module export** — `routeCompletion(tenantContext,
  routingService, request)` in `src/index.ts`, alongside the
  `ModuleDefinition`, following the pattern in
  `services/identity-and-tenancy/src/index.ts`. If `agent-runtime` (built
  concurrently) ends up calling this module in-process rather than over
  HTTP, it can import this function (or construct its own
  `RoutingService`) instead of reaching into internal files.
- **Tests** (`tests/`):
  - `anthropic-provider.test.ts` — mocks `@anthropic-ai/sdk` (no real
    network calls); covers the missing-API-key failure path, the
    SDK-response-to-`LlmCompletionResult` mapping, and multi-block text
    joining.
  - `routing-service.test.ts` — covers provider dispatch, decision/outcome
    logging via an injected fake `Logger`, and error propagation.
  - `routes.test.ts` — boots a real `http.Server` (matching
    `services/ledger/tests/routes.test.ts`'s pattern) against a fake
    `RoutingService`; covers validation errors, the happy path, and
    `PlatformError`-to-HTTP-status mapping.
  - `smoke.test.ts` — pre-existing module-registration contract test.

## Deferred / stubbed

- **No real Anthropic call can be exercised in this environment.** There
  is no real `ANTHROPIC_API_KEY` configured (per `.env.example` /
  `packages/config`), so the only way to observe `AnthropicProvider`
  against the live Anthropic API is with real credentials. Tests mock the
  SDK; a `curl` against a booted `apps/api-server` reaches
  `PROVIDER_UNAVAILABLE` (503) cleanly rather than completing a real call —
  confirmed as part of this deliverable's verification.
- **Multi-provider routing and four-tier classification (Advanced/High/
  Good/OpenSource) are Phase 5 / Sprint 5.1 scope**, not built here. The
  `LlmProvider` seam and the fact that `RoutingService` never branches on
  provider identity are what make that future work additive rather than a
  rewrite.
- **No `routing_decisions` persistence.** Decisions are logged, not
  written to a table — see rationale above.
- **No retry/failover logic.** A provider failure propagates as an error
  to the caller; failover across providers is part of the Phase 5 routing
  logic.

## Status

Backend dispatch implemented per Deliverable 2.1.2. See `src/index.ts` for
module registration and the typed export, `src/provider.ts` /
`src/anthropic-provider.ts` for the provider seam and its v1
implementation, `src/routing-service.ts` for the dispatch/logging logic,
`src/routes.ts` for the HTTP surface, and `tests/` for coverage.
