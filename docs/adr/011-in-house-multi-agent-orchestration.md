# ADR 011: In-house multi-agent orchestration, not LangGraph

- Status: Accepted
- Date: 2026-06-28
- Deciders: founder, lead engineer (pending sign-off)

## Context

Phase 4 (Multi-Agent Meetings) requires the platform to support two
distinct ways an agent contribution enters a meeting, per Platform
Specification §2.2–§2.3:

1. **Hand-raise from background observation.** Multiple agents present in
   a meeting (e.g. CFO, CMO, CRO) independently watch the conversation and
   decide, on their own, when something is worth interjecting. When
   relevant, an agent does its analysis work — sub-agent dispatch, brain
   retrieval — _before_ signalling a hand-raise, so the signal-to-floor
   latency stays low (§13.2: P95 hand-raise to first agent audio < 1.5s).
   Multiple agents can independently decide to raise a hand on the same
   turn.
2. **Direct address.** The founder asks a specific agent a question by
   name. This is a direct request, not a competition for the floor — it
   bypasses the observation/relevance step entirely.

A naive implementation of (1) — every present agent surfacing
independently — produces exactly the noise problem the founder flagged:
three agents (sales, marketing, finance) all raising a hand on the same
turn is not three separate signals, it's one moment that needs
consolidating. Platform Specification §2.3 already names the resolution
shape: **convergence** (agents agree, one presents a unified view, others
indicate agreement), **factual disagreement** (surface both positions
explicitly), or **strategic-judgement deferral** (surface one explicit
question to the founder). "Background debate occurs invisibly. Only the
resolution surfaces."

This raised the orchestration-framework question explicitly deferred
since the early sessions of this build (see CLAUDE.md working-style
note: "address it when we get there"). LangGraph (specifically
LangGraph.js, the TypeScript port) was the named alternative to
hand-rolling this.

## Options considered

### Option A — LangGraph.js

A graph-based orchestration framework with built-in checkpointing,
human-in-the-loop interrupts, and multi-agent subgraph composition.

Trade-offs:

- Its natural usage pattern is a supervisor node routing through a graph
  of agent nodes — sequential or branching, one traversal at a time. The
  actual requirement here is N independent agents racing to evaluate the
  _same_ turn in parallel, which doesn't map onto graph traversal without
  either looping through agents synchronously inside one node (kills the
  parallelism, adds latency exactly where the 1.5s budget can't afford
  it) or spinning up N separate graph invocations per agent — at which
  point no graph behaviour is actually being used, just paid for.
  Confirmed during this session's design discussion: the parallel
  fan-out is a pub-sub problem, not a graph-traversal problem.
- LangGraph.js is a TypeScript port of a Python-first framework — smaller
  community, less battle-tested, for something this core to the product.
- Its checkpointer/state-channel model is implicit machinery (state
  passed through the framework's own constructs) that would have to be
  audited and wrapped carefully to not undercut ADR 007's explicit-context
  mandate — every other piece of this codebase (`@voai/db`'s `withTenant`,
  `@voai/auth-context`'s `TenantContext`, `@voai/events`) was deliberately
  hand-rolled specifically to satisfy that mandate. LangGraph would be the
  first major external dependency built on different assumptions.

### Option B — In-house orchestration on existing primitives

Use `@voai/events` (already built) for fan-out, plain async functions for
per-agent observation, and one new bounded consolidation step.

Trade-offs: more code to write and own; no free checkpointing or
interrupt machinery — session/state persistence goes through `@voai/db`
as everything else already does.

## Decision

**Option B.** A three-stage pipeline, all on existing primitives:

**Stage 1 — Parallel observation (fan-out, no orchestration framework).**
Every transcript append publishes a `transcript.appended` event via
`@voai/events`. Every agent present in the meeting has its own
independent subscriber. Each subscriber: (a) does a cheap relevance check
first — not a full LLM call on every turn, for cost and latency; (b) if
relevant, does the real analysis (sub-agent dispatch, brain retrieval)
and caches the prepared contribution; (c) emits a `hand.candidate` event.
This is embarrassingly parallel and needs no central coordinator.

**Stage 2 — Collision-gated LLM arbiter.** A short debounce window (a few
hundred ms to a couple of seconds) collects `hand.candidate` events per
session.

- **If exactly one candidate lands in the window, skip the arbiter
  entirely** and pass it straight to Stage 3. No LLM call, no added
  latency — the single-hand-raise P95 target stays untouched on the
  common path.
- **If two or more candidates collide**, an LLM call (not a rule engine)
  judges convergence/conflict/values-question per §2.3, given each
  candidate's persona name and already-prepared contribution (short
  text, not the full transcript or reasoning chain). Rules were
  considered and rejected: the topic space is unbounded and the agent
  roster grows over time via the marketplace (Platform Spec §6.4,
  hire/fire of specialist agents) — a case-based rule engine cannot be
  maintained against either axis. The arbiter's input is just "however
  many prepared contributions exist right now, from whichever personas
  are active for this tenant" — it scales to a larger roster with zero
  code change, which is the actual answer to "orchestrate capabilities on
  the fly."

**Stage 3 — Founder-facing hand-raise queue.** `meeting` (which already
owns session state) receives at most one consolidated signal per
collision window, not N competing ones. Floor granted by founder
acknowledgement (voice or click, per §2.2); raised hands expire after 5
minutes per spec, configurable.

**Direct address** bypasses all three stages: ack-detection (§2.2) routes
straight to the named agent's full contribution pipeline.

## Rationale

The parallel-fan-out requirement is structurally a pub-sub problem;
`@voai/events` already exists and is already wired into every module's
`ModuleContext`. The one place genuine cross-cutting judgement is needed
(the arbiter) is a single bounded function operating on a small, already-
computed batch — not a multi-turn graph traversal with branching control
flow — so it doesn't need a graph engine to express. Keeping this
in-house keeps the one truly novel/dynamic part of the system (handling
an open-ended, growing agent roster) resting on the same explicit,
typed, hand-rolled foundation as the rest of the platform, rather than
introducing the first major framework dependency with different
assumptions about state and context propagation.

## Consequences

- `agent-runtime` gains: a per-agent observer/relevance-check path, and a
  `ConvergenceArbiter` (or similarly named) component implementing Stage
  2, subscribing to `hand.candidate` events.
- `meeting` gains: the hand-raise queue and floor-grant/expiry logic
  (Stage 3), since it already owns session and transcript state.
- The arbiter's prompt and output schema (which agent presents on
  convergence, how "others agree" is attributed, how a conflict panel's
  two positions are structured) is real product content, same caliber as
  a persona system prompt — to be designed deliberately, not treated as
  boilerplate, before Phase 4 implementation starts.
- No new framework dependency. `@voai/events`, `@voai/db`, and the
  `routing`/`agent-runtime` seams already built in Wave 1/2 carry this
  design without modification to their existing contracts.

## Revisit triggers

- If Phase 4 implementation reveals genuinely complex cross-cutting
  branching logic that the fan-out + collision-gated-arbiter shape can't
  express cleanly (e.g. multi-round debate before convergence, not just a
  single collision-and-resolve step), reconsider whether a graph
  abstraction earns its cost at that point — preferably evaluated against
  the actual shape of the problem encountered, not in the abstract.
- If LangGraph.js's TypeScript-port maturity improves substantially and a
  different, narrower piece of the system would clearly benefit, that's a
  separate decision from this one — this ADR is scoped to the
  meeting-room hand-raise/convergence pipeline specifically, not a
  blanket rejection of the framework for every future use.
