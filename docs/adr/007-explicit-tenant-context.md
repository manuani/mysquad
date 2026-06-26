# ADR 007: Explicit TenantContext value type, superseding ADR 006

- Status: Accepted — supersedes ADR 006
- Date: 2026-06-26
- Deciders: lead engineer (pending sign-off)

## Context

`docs/handoff/VERIFICATION_BACKLOG.md` Issue 5 (critical): ADR 006 chose
`AsyncLocalStorage` to propagate tenant and user context. System
Architecture §8.1.1 layer 2 mandates: "The context is propagated through
async work via explicit context parameters; no implicit globals."
`AsyncLocalStorage` is exactly the implicit-globals pattern this line
forbids — it is a global store read by ambient lookup rather than a value
threaded through call signatures. §3.6 reinforces this: "There is no
overload that accepts a query without tenantId; cross-tenant queries are
not expressible in the codebase." An ambient store makes the "not
expressible" property unenforceable at the type level: any function can
silently omit the tenant parameter and still compile, because it can
always fall back to reading the store.

ADR 006 was right that the failure mode to design against is silent
cross-tenant leakage from a forgotten parameter. It was wrong about which
failure mode that risk concentrates in: an implicit store removes the
compiler's ability to catch a missing tenant parameter at every call site,
trading a code-review risk for a runtime-only risk.

## Options considered

### Option A — Thread `TenantContext` as an explicit first parameter

Every function that touches tenant-scoped data takes `tenantContext:
TenantContext` as its first parameter. The type checker enforces presence
at every call site; there is nothing to "forget" that compiles.

Trade-offs: more verbose signatures. Test setup constructs and passes a
context value instead of wrapping in a context-setting helper.

### Option B — Keep `AsyncLocalStorage`, add a lint rule banning calls outside `withAuthContext`

Keeps ADR 006's ergonomics, adds tooling to catch the gap.

Trade-offs: still violates §8.1.1 literally — the context remains an
implicit global; a lint rule is enforcement bolted on top of a mechanism
that is structurally the wrong shape. Lint rules can be suppressed or
miss call paths a type checker would catch unconditionally.

### Option C — Custom per-request DI container

Considered and rejected in ADR 006 for the same reasons (more
infrastructure than needed); nothing about Issue 5 changes that
calculus.

## Decision

**Option A.** Tenant and user context is the `TenantContext` value type
exported from `@voai/auth-context`:

```ts
export interface TenantContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly userType: 'founder' | 'admin' | 'expert';
  readonly sessionId: string;
}
```

It is constructed once per request (API gateway middleware, from the
session token) or once per job (job runner, from the job payload) via
`buildTenantContext()`, which validates all required fields are present.
From that point it is passed as an explicit parameter through every
function that needs it — never read from a side channel.

## Rationale

This directly satisfies §8.1.1 layer 2 as written, not as a close
approximation. It also makes the "no overload without tenantId" property
from §3.6 a property the type checker enforces: a function signature
either has the parameter or it does not, and there is no fallback path
that lets a call compile without it.

## Consequences

- `packages/auth-context/src/index.ts` no longer uses
  `node:async_hooks`. `AuthContext`/`withAuthContext`/`currentAuthContext`/
  `requireAuthContext` are removed; replaced by `TenantContext` and
  `buildTenantContext()`.
- `packages/types/src/module.ts` documents the convention: any
  cross-module service export or internal tenant-scoped function takes
  `tenantContext: TenantContext` first. `ModuleContext` (process-wide
  infrastructure) deliberately does not carry tenant identity.
- Every future service module's handlers and internal functions follow
  this signature from the start — there is no precedent to migrate away
  from after Sprint 1.2, which was the urgency behind fixing this before
  Identity-and-Tenancy is built.
- Test setup constructs a `TenantContext` value directly rather than
  wrapping assertions in a context-setting helper. Slightly more
  verbose; nothing to leak across tests since there is no shared store.

## Revisit triggers

- If a future profiling exercise shows explicit-parameter threading
  causing measurable overhead or unmanageable signature noise at scale
  (unlikely — this is a value object, not a heavy context).
- If we discover a call path (e.g. deeply nested sub-agent dispatch)
  where explicit threading becomes impractical; the response would be a
  scoped context object passed at the entry point of that subsystem, not
  a return to ambient global state.
