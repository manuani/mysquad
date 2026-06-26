# ADR 005: Express for HTTP routing at v1

- Status: Accepted
- Date: 2026-05-03
- Deciders: founder, lead engineer (pending sign-off)

## Context

The api-gateway needs an HTTP framework. Each module returns a router
that the gateway mounts at `/v1/<name>`. The framework choice affects
latency (Phase 8 P95 targets), middleware ergonomics, and the long-tail
of every developer's daily work.

## Options considered

### Option A — Express 4

The default. Largest ecosystem. Every middleware we are likely to need
(body parsing, CORS, helmet, request logging) is a one-liner.

Trade-offs: slower than Fastify on synthetic benchmarks. Older Promise
handling — async middleware needs care.

### Option B — Fastify 5

Faster than Express on most benchmarks. Built-in JSON schema validation.
Hooks system is cleaner than Express middleware.

Trade-offs: smaller ecosystem. Some integrations (e.g. older WorkOS
samples) assume Express. The performance gap is real but unlikely to be
the bottleneck before Phase 8 — the LLM calls dominate latency.

### Option C — Hono

Smallest, fastest. Edge-runtime compatible.

Trade-offs: ecosystem is much smaller. Migrating from Express patterns
takes more thought.

## Decision

**Option A.** Express 4 at v1.

## Rationale

The platform's latency budget is dominated by LLM calls (1-4 seconds for
contributions), STT/TTS (~600ms P95), and database queries (<800ms P95
for brain queries). HTTP framework overhead is in the low milliseconds —
it is not the bottleneck. Optimising it now would be a misapplied effort.

The ecosystem advantage is concrete: the WorkOS, Stripe, and LiveKit
sample code assumes Express. Saving a day of integration time on each is
real value.

## Consequences

- `@voai/types` exports `ModuleHandle.router` as `express.Router`. If we
  change frameworks, this type changes and every module signature
  follows. That is the right level of coupling — explicit, in one file.
- Middleware (auth, tenant context propagation, error handling) is added
  in Sprint 1.2 as Express middleware.

## Revisit triggers

- Phase 8 latency analysis identifies HTTP routing as a bottleneck on
  any path. (Plausible only on the realtime meeting transport, where we
  may use LiveKit's own server SDK instead anyway.)
- A module needs a feature only available in Fastify or Hono (e.g.
  per-route schema validation as a hard requirement).
