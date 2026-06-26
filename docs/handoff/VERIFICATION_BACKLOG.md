# Verification Backlog

Gaps between the current skeleton (Deliverable 1.1.1) and the consolidated
System Architecture v2. Address before or during the relevant sprint.

Each issue has: severity, impact, fix scope, and the sprint that's blocked
if it isn't resolved.

---

## Issue 1 — Identity and Tenancy split into two services

**Severity:** Medium
**Blocks:** Sprint 1.2 (Identity and authentication)
**Status:** Open

System Architecture §3.1 lists eleven components; "Identity and Tenancy"
is treated as **one component** in §3.4.1, §3.5, and §8.1.1. The current
skeleton has two separate workspaces (`services/identity` and
`services/tenancy`).

**Fix:**
1. Merge `services/tenancy` into `services/identity`, rename to
   `services/identity-and-tenancy` (or just `identity` keeping the broader
   scope clear in its README).
2. Update `apps/api-gateway/src/index.ts` MODULES array.
3. Update `apps/api-gateway/tests/registration.test.ts` expected count from
   12 to 11.
4. Update `docs/adr/004-service-module-list.md` (supersede with new ADR
   noting the correction).

---

## Issue 2 — Edge Gateway treated as application code (it isn't)

**Severity:** Low
**Blocks:** Sprint 1.1.3 (Staging deployment pipeline)
**Status:** Open

§3.1 names "Edge gateway" as a component — TLS termination, rate limiting,
request routing, WebRTC signalling negotiation. This is infrastructure
(CDN, load balancer, WAF), not an application module. The current
`apps/api-gateway` is misnamed: it's the API server pool from §3.7, not
the edge gateway.

**Fix options:**
- **(a) Rename** `apps/api-gateway/` to `apps/api-server/`. Add
  `infra/edge-gateway/` for the load-balancer/WAF config when Sprint 1.1.3
  lands.
- **(b) Keep** the name and add a clarifying note in the app README that
  this is the API server pool, with edge-gateway as infra-level.

Recommend (a) — more honest and avoids the term collision.

---

## Issue 3 — Object store missing from `@voai/db`

**Severity:** Medium
**Blocks:** Sprint 1.1.2 (Local development environment)
**Status:** Open

§4.1 names five stores: Postgres (with pgvector), vector store, Neo4j,
Redis, **object store** (S3/GCS, per §4.2.4). The current
`packages/db/src/index.ts` exposes only the first four.

**Fix:**
1. Add `ObjectStoreClient` interface to `packages/db/src/index.ts`. Surface:
   `getObject(key)`, `putObject(key, body, contentType)`,
   `deleteObject(key)`, `presignGetUrl(key, expiresIn)`,
   `presignPutUrl(key, expiresIn, contentType)`.
2. Add `objectStore: ObjectStoreClient` to `DatabaseClients`.
3. Per §4.2.4, keys are tenant-prefixed: `{tenantId}/{sessionId}/...`.
   Encode this in a helper.

---

## Issue 4 — Four of five process types have no app entrypoints

**Severity:** Low at v1; rising over time
**Blocks:** Phase 2+ work
**Status:** Open (architectural intent)

§3.7 specifies five process types. The skeleton has only the API server.

| Process type | Skeleton location | Status |
|---|---|---|
| API server pool | `apps/api-gateway` | Present |
| Background worker pool | `apps/worker` | **Missing** |
| Media coordinator pool | `apps/media-coordinator` | **Missing** |
| Scheduled job runner | `apps/scheduler` | **Missing** |
| Admin console (separate web app) | `apps/admin-web` | Placeholder README only |

**Fix:**
Add `apps/worker/`, `apps/media-coordinator/`, `apps/scheduler/` as
workspace placeholders with READMEs explaining their role and the sprint
that populates them. Don't bundle worker logic into the API server when
that work starts (Phase 2).

---

## Issue 5 — CRITICAL: ADR 006 contradicts §8.1.1

**Severity:** High
**Blocks:** Sprint 1.2.2 (Tenant model and enforcement)
**Status:** Open — must fix before Sprint 1.2 builds on the wrong pattern

§8.1.1 layer 2 mandates: *"The context is propagated through async work via
**explicit context parameters; no implicit globals**."* §3.6 confirms:
*"There is no overload that accepts a query without tenantId; cross-tenant
queries are not expressible in the codebase."*

ADR 006 chose `AsyncLocalStorage`. That's exactly the implicit-globals
pattern the architecture forbids. Worse, `ModuleContext` doesn't carry
tenantId at the signature level — it relies on the implicit context.

**Fix:**
1. Write ADR 007 superseding ADR 006. New decision: explicit `TenantContext`
   value type threaded as the first parameter on every internal API.
2. Replace `packages/auth-context/src/index.ts` AsyncLocalStorage with a
   plain value type:
   ```ts
   export interface TenantContext {
     readonly tenantId: string;
     readonly userId: string;
     readonly userType: 'founder' | 'admin' | 'expert';
     readonly sessionId: string;
   }
   ```
3. Update `packages/types/src/module.ts` so service-call signatures take
   `tenantContext` as the first parameter, not from a side channel.
4. Update existing tests in `packages/auth-context/tests/` (delete
   AsyncLocalStorage-specific ones; add explicit-threading ones).

This is the **highest-priority fix** because every service module built
in subsequent sprints will follow the precedent. Fixing it after Sprint 1.2
means rewriting Identity-and-Tenancy.

---

## Issue 6 — PostgresClient missing the session-level pattern

**Severity:** Medium
**Blocks:** Sprint 1.1.2 (Local development environment) wiring
**Status:** Open

§8.1.1 layer 3 mandates: *"the database connection acquired for a request
has its session-level `app.tenant_id` setting set immediately."*

The current `PostgresClient` interface is just a `query` method — no
concept of acquiring a tenant-scoped connection. This means layer 3
enforcement is impossible without bypassing the interface.

**Fix:**
1. Replace the `query` method with:
   ```ts
   withTenant<T>(tenantId: string, fn: (client: TenantScopedClient) => Promise<T>): Promise<T>;
   ```
2. The `TenantScopedClient` exposes `query` but is only available inside
   the `withTenant` callback. Internally, `withTenant` acquires a pool
   connection, runs `SET LOCAL app.tenant_id = $1`, runs the callback,
   releases.
3. Document the pattern in `packages/db/README.md` and the related ADR.

---

## Working through the backlog

Recommended order:
1. **Issue 5 first** — blocks everything else by setting precedent.
2. **Issue 6** — pairs with Issue 5 (same architectural concern); fix
   together.
3. **Issue 1** — does the merge while the surface area is still small.
4. **Issue 3** — quick interface addition.
5. **Issue 2** — naming change.
6. **Issue 4** — placeholder workspaces.

All six can fit in a single corrective session before Sprint 1.1.2 starts.
Suggested session title: *"Sync corrections to Deliverable 1.1.1 from
consolidated System Architecture v2."*
