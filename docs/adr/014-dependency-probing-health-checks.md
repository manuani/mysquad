# ADR 014: Health checks probe real dependencies

- Status: Accepted
- Date: 2026-08-11
- Deciders: lead engineer

## Context

Every service module returned a hardcoded `{ status: 'healthy' }` from its
`health()` callback, and `/healthz` aggregated those constants. The check
therefore could not fail. This was found by observation, not by reasoning: after
a machine reboot the platform reported all twelve modules healthy while Postgres
was not running at all.

That is the failure mode a health check exists to catch. Architecture v2 §8
expects `/healthz` to gate ECS task replacement and deploys, so a check that
always answers "healthy" tells the load balancer to keep routing traffic into a
process that cannot serve a single request.

Modules do not share a dependency set: nine use Postgres only, `marketplace`
also uses Neo4j, and `routing` and `voice-gateway` use no datastore at all —
their dependencies are LLM providers and LiveKit.

## Options considered

### Option A — probe inside each module, per module

Each module writes its own probe. Maximum fidelity, but twelve copies of timeout
and error-formatting logic that will drift, and nine of them identical.

### Option B — a shared probe helper; modules declare their dependencies

Add `ping()` to the datastore clients and a `checkDependencies({ postgres, … })`
helper that probes concurrently and aggregates. Modules pass only the stores they
use. Uniform behaviour; modules that need nuance can still compose it.

### Option C — probe centrally in api-server, once

Probe the datastores once at the aggregate level rather than per module. Cheapest
(one probe per store per request), but loses the per-module mapping, so the
response cannot say which modules are actually affected, and it cannot express a
module-specific judgement like marketplace's.

## Decision

**Option B.** `ping()` on the Postgres, Neo4j, and Redis clients;
`checkDependencies()` in `@voai/db`; each module declares what it uses.

Status carries a defined meaning:

| Status      | HTTP | Meaning                                                     |
| ----------- | ---- | ----------------------------------------------------------- |
| `healthy`   | 200  | Every dependency answered                                    |
| `degraded`  | 200  | Reduced capability, still serving                            |
| `unhealthy` | 503  | A required dependency is unreachable; `reason` names which   |

## Rationale

`degraded` returning 200 is the load-bearing choice. A balancer must not pull a
task out of rotation because an *optional* dependency is missing — that converts
a partial outage into a total one. So `marketplace` reports degraded when Neo4j
is unreachable (expert listing still works off Postgres; only graph-based
matching is lost), and `routing` reports degraded when it has no failover
provider but is unhealthy only when *no* provider is configured, since tiers fail
over downward.

`routing` checks credential availability rather than issuing a real completion:
probing an LLM provider honestly would mean a billable API call on every health
check, and the failure that actually bites is an unconfigured provider throwing
on first use.

Probes are capped at 2 s each. Unbounded, a store that accepts connections but
never answers would hang `/healthz` instead of reporting the outage — which
reads to a balancer as a timeout rather than a diagnosis.

## Consequences

Easier:

- `/healthz` is now a genuine readiness signal and safe to gate deploys on.
- Failures name the dependency: `"postgres: connect ECONNREFUSED ::1:5432"`.

Harder:

- Every health check now costs a round trip per dependency. At ECS's default
  30 s interval this is negligible, but a sub-second health check interval would
  put real load on Postgres.
- **`/healthz` returning 503 means ECS will replace tasks during a Postgres
  outage.** That is usually correct, but it means a database blip cycles tasks.
  Worth confirming against the deployment's restart policy.

### Bug this surfaced

`pg.Pool` emits an `error` event on *idle* clients when the server goes away — a
restart, a failover, an admin terminating backends. An `error` event with no
listener is a fatal unhandled error in Node, so **a Postgres restart killed the
entire api-server process.** With a listener attached the process now rides out
the outage: verified by stopping Postgres (503, process alive) and starting it
again (200, recovered without a restart).

This was pre-existing and unrelated to health checks; it was found only because
testing the check required taking Postgres down. Any RDS maintenance window
would have triggered it.

## Revisit triggers

- Health check interval drops below a few seconds, making probe cost material —
  cache results for a short TTL.
- A dependency needs deeper checking than liveness (replication lag, disk
  pressure), which `ping()` deliberately does not express.
- Task-cycling during database blips proves disruptive, in which case
  distinguish liveness (`/livez`, process is up) from readiness (`/healthz`).
