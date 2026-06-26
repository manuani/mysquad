# ADR 003: Modular monolith with in-process module registration

- Status: Accepted
- Date: 2026-05-03
- Deciders: founder, lead engineer (pending sign-off)

## Context

System Architecture v1 commits the platform to a modular monolith. v2 §1
preserves that commitment unchanged: "The architectural foundation —
modular monolith, seven layers, six performance signals, weekly evaluation
cycle — remains the backbone."

The skeleton needs to express this architecture concretely: how does a
module declare itself, how does the platform boot it, how do modules talk
to each other, how do we keep the option open to extract a module to a
separate process later if we need to.

## Options considered

### Option A — Plain Express app, every route file imported into one big router

Simplest. No abstraction.

Trade-offs: nothing prevents a route in the brain service from reaching
into the meeting service's database tables directly. The monolith stays a
ball of mud. Extracting a module later means rewriting it.

### Option B — In-process module registration with a typed contract

Each module exports a `ModuleDefinition` with a `register(ctx)` function.
The platform calls `register` in dependency order, gets back a router and
a health probe, and mounts the router. Modules import each other through
their public service exports.

The boundary is enforced socially (code review against the contract) and
mechanically (each module has its own workspace `package.json`, so an
unauthorised import shows up as a missing dependency).

### Option C — Microservices from day one (gRPC, Kubernetes)

Strongest isolation. Highest operational cost.

Trade-offs: the v1 architecture explicitly rejects this. Operational cost
of microservices is unjustified at our team size and scale through Phase
1 launch.

## Decision

**Option B.** Each service module exports a `ModuleDefinition` from
`@voai/types`. The api-gateway boots them in a fixed dependency order and
mounts each at `/v1/<name>`. Inter-module communication is via typed
service exports for synchronous calls and via the in-process event bus
(`@voai/events`) for fire-and-forget signals.

## Rationale

The contract makes the modular boundaries first-class and gives us a
clean extraction story without the operational cost of microservices on
day one. Three properties matter:

1. **The boundary is visible.** A `package.json` per module means
   accidental imports across boundaries fail at install time, not
   runtime.
2. **Boot order is explicit.** `apps/api-gateway/src/index.ts` lists
   modules in dependency order. That list is the topology.
3. **Extraction is mechanical.** A module that needs to scale separately
   later can move to its own process by replacing the in-process
   `EventBus` and any direct service imports with HTTP/gRPC clients,
   without changing the module's own code.

## Consequences

- Every service module follows the same template:
  `services/<name>/src/index.ts` exports a `ModuleDefinition`.
- A platform-wide `ModuleContext` carries config, logger, db clients, and
  event bus into every module — modules never instantiate these.
- `apps/api-gateway/tests/registration.test.ts` enforces the contract for
  every module on every CI run.
- Adding a new module: create the workspace, export a `ModuleDefinition`,
  register it in the gateway's MODULES array, add it to the registration
  test.
- Deployment unit is the api-gateway. Scaling is by replication.

## Revisit triggers

- A module needs a runtime that the rest of the platform does not use
  (e.g. real-time STT in a memory-bound process).
- A module needs an isolation guarantee the in-process model cannot give
  (e.g. customer-data segregation requirements from a future enterprise
  contract).
- A module's resource profile diverges sharply from the rest of the
  platform (e.g. always-on vs bursty).
