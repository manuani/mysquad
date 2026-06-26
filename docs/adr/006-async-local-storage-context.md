# ADR 006: Tenant and user context propagation via AsyncLocalStorage

- Status: Superseded by ADR 007 — violated System Architecture §8.1.1's
  explicit-context-parameters mandate (verification backlog Issue 5)
- Date: 2026-05-03
- Deciders: founder, lead engineer (pending sign-off)

## Context

Sprint 1.2.2 (Tenant model and enforcement) requires that "Cross-tenant
access is blocked at all layers" and "Boundary tests pass. A founder in
tenant A cannot read tenant B data through any API path."

To enforce this, every database query, event publish, and outbound call
needs to know the active tenant. The naïve approach is to thread
`tenantId` as a parameter through every function. That works but it
fails open: any function that forgets to pass the parameter loses the
constraint.

## Options considered

### Option A — Thread tenant context as a parameter through every call

Explicit. Visible in every signature.

Trade-offs: every code reviewer, on every PR, has to confirm the
parameter is plumbed correctly. One miss, and a query runs without the
tenant filter.

### Option B — Node `AsyncLocalStorage` to carry context implicitly

A single store is populated at the top of every request (in API
middleware) and at the start of every background job (in the job
runner). Every downstream call reads from it. Code that needs the
context calls `requireAuthContext()`, which throws if missing.

Trade-offs: implicit data flow. Tests need to wrap calls in
`withAuthContext()`. The store survives across `await` boundaries
(this is what AsyncLocalStorage is for) but engineers unfamiliar with
it can be surprised.

### Option C — A custom dependency-injection container per request

Most flexible. Unfamiliar to most TypeScript engineers. More
infrastructure than we need.

## Decision

**Option B.** Tenant and user context propagate via Node
`AsyncLocalStorage`, exposed through `@voai/auth-context`.

## Rationale

The platform's failure mode for multi-tenancy is silent cross-tenant
data leakage. The mechanism that prevents that needs to fail closed:
forgetting to set up the context should make queries impossible, not
make them unfiltered.

`requireAuthContext()` does exactly that. Code that touches
tenant-scoped data calls it, and if the context is missing the call
throws with `TenantViolationError`. The boundary tests in Sprint 1.2.2
will assert on that throw.

## Consequences

- API middleware in `services/identity` and `services/tenancy` (Sprint
  1.2) populates the context from the session token before any handler
  runs.
- Background jobs (extraction, metering, evaluation) populate the
  context from the job payload before doing any tenant-scoped work.
- Every database client wrapper in `@voai/db` reads tenant from the
  context and adds it to every query — modules do not pass tenant
  manually.
- Tests use `withAuthContext()` to wrap calls. The pattern is in
  `packages/auth-context/tests/auth-context.test.ts`.

## Revisit triggers

- A future Node release breaks AsyncLocalStorage performance under our
  load. (Unlikely; it is the documented mechanism.)
- We discover an attack vector that bypasses the context (e.g. raw SQL
  passed in user input). The response would be additional DB-level
  enforcement, not a different propagation mechanism.
