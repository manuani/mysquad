# ADR 008: Merge Identity and Tenancy into one module, superseding ADR 004's count

- Status: Accepted — supersedes ADR 004's twelve-module list
- Date: 2026-06-26
- Deciders: lead engineer (pending sign-off)

## Context

`docs/handoff/VERIFICATION_BACKLOG.md` Issue 1: ADR 004 inferred a
twelve-module service list before System Architecture v1 was available in
project knowledge. System Architecture §3.1 lists eleven major
components; §3.4.1, §3.5, and §8.1.1 all treat "Identity and Tenancy" as
**one** component — the authentication layer and the tenant-isolation
layer are described together because session tokens carry tenant context
and the isolation boundary is enforced at the same layer that issues
those tokens (the merged `withTenant`/`TenantContext` work in ADR 007
makes this concretely true in code, not just in the prose). The skeleton
built `services/identity` and `services/tenancy` as two separate
workspaces, which doesn't match the architecture's component boundary and
would have forced an artificial split of code that genuinely belongs
together (e.g., where does tenant-boundary middleware live if sign-in and
tenant context are different modules?).

## Options considered

### Option A — Merge into `services/identity-and-tenancy`

One module, one `ModuleDefinition`, matching the architecture's eleven
components exactly.

Trade-offs: larger single module covering two sprints' worth of work
(Sprint 1.2 and Sprint 1.2.2). Acceptable — the architecture's own
component boundary already groups them; splitting workloads inside one
module by sprint is a normal incremental-build pattern, not a structural
problem.

### Option B — Keep both modules, document the count mismatch

Leaves a wrong abstraction in place because fixing it later (after Sprint
1.2 builds real handlers in two places) is more expensive than fixing it
now while both are stubs.

### Option C — Keep both modules as separate `services/*` workspaces but treat them as one logical component in documentation only

Doesn't fix the actual problem: a future cross-module import rule (no
reaching into another module's internals) would block identity and
tenancy code from sharing internals even though the architecture says
they're the same component.

## Decision

**Option A.** `services/identity` and `services/tenancy` are merged into
`services/identity-and-tenancy`, a single workspace exporting one
`ModuleDefinition` named `identity-and-tenancy`.

## Consequences

- `apps/api-gateway/src/index.ts` `MODULES` array now has 11 entries
  (was 12); `apps/api-gateway/tests/registration.test.ts` asserts
  `toHaveLength(11)`.
- `apps/api-gateway/tsconfig.json` and the root `tsconfig.json` project
  references updated to point at `services/identity-and-tenancy` instead
  of the two removed paths.
- `apps/api-gateway/package.json` dependency on `@voai/identity` and
  `@voai/tenancy` replaced with `@voai/identity-and-tenancy`.
- Sprint 1.2 (Identity and authentication) and Sprint 1.2.2 (Tenant model
  and enforcement) both land their real handlers in this one module
  going forward, rather than coordinating across two.
- This is fixed before either sprint starts building real logic, so
  there is no migration cost beyond the skeleton-stage rename performed
  here.

## Revisit triggers

- If Identity-and-Tenancy grows large enough that sign-in flows and
  tenant-isolation enforcement develop genuinely independent release
  cadences or ownership (unlikely at v1 scale; the architecture's own
  boundary groups them for a structural reason, not a convenience
  reason).
