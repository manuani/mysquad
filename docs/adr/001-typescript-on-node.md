# ADR 001: TypeScript on Node 20 LTS for backend services

- Status: Accepted
- Date: 2026-05-03
- Deciders: founder, lead engineer (pending sign-off)

## Context

Phase 1, Sprint 1.1, Deliverable 1.1.1 requires choosing the language and
runtime for the platform backend. The decision needs to support: a modular
monolith spanning ~12 service modules; the SDK ecosystem the platform
depends on (LiveKit, Stripe, WorkOS, Anthropic, Sarvam AI); the React Native
mobile client landing in Sprint 1.3.1; and an evaluation harness in
Sprint 5.3.

System Architecture v2 §10 (Build-Start Technology Decisions) confirms
specific provider choices but the underlying language is not in v2. v1 is
referenced as the source for that decision but is not in project knowledge
at the time of this skeleton.

## Options considered

### Option A — TypeScript on Node 20 LTS

One language for backend services and the React Native mobile app. Strong
typing across module boundaries. First-class SDKs from every vendor we
depend on. Single set of build tools and CI workflows.

Trade-offs: weaker fit than Python for ML/eval tooling. Async/await
ergonomics are good but the LLM-streaming stack in Python (e.g. async
generators with structured output) is more mature.

### Option B — Python (FastAPI / asyncio)

Stronger fit for evaluation harnesses and any in-house ML work. Separate
language from React Native means less type-sharing between client and
server.

Trade-offs: separate runtime from the mobile client. A cross-platform team
either becomes polyglot or splits. Dependency injection patterns are less
standardised than in TypeScript.

### Option C — TypeScript backend with Python `evals/` workspace

Default to TypeScript for services. Carve out a Python workspace under
`evals/` for the AI Quality Lead's evaluation harness, communicating with
the platform over HTTP.

Trade-offs: two-language maintenance overhead, but bounded — the boundary
is well-defined and the evals workspace runs on its own schedule.

## Decision

**Option C.** TypeScript on Node 20 LTS for all service modules and the
api-gateway. The `evals/` workspace is reserved for Python (or whatever
the AI Quality Lead decides) starting in Sprint 5.3.

## Rationale

The dominant constraint is that the same team writes the React Native app
(Sprint 1.3.1) and the backend. One language across both reduces hiring
footprint and lets `@voai/types` be the literal source of truth for the
client-server contract — a guarantee Python cannot offer.

The eval workspace is intentionally isolated. The AI Quality Lead has the
freedom to pick the right tool for that work without forcing it on the
service team.

Node 20 LTS specifically: the LTS support window covers Phase 1 through the
v1 launch. Native test runner and stable AsyncLocalStorage are exactly what
we need (see ADR 006).

## Consequences

- All services compile with the same `tsconfig.base.json`.
- `pnpm` workspaces and `turbo.json` orchestrate one build pipeline.
- React Native imports `@voai/types` directly, so the API contract cannot
  drift between client and server.
- Eval workspace is on its own track; it does not block service work.

## Revisit triggers

- If a P95 latency target in Phase 8 cannot be met because of Node
  performance for a specific path (e.g. STT streaming), that path may move
  to a separate Rust or Go binary called over a local socket.
- If the AI Quality Lead decides Python in `evals/` would be better
  embedded in the service tree, ADR-005's HTTP service framework choice may
  need revisiting.
