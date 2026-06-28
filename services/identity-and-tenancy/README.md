# @voai/identity-and-tenancy

Identity and Tenancy Service.

Per System Architecture §3.1, §3.4.1, §3.5, and §8.1.1, Identity and
Tenancy is treated as one component, not two. This module merges what was
previously `services/identity` and `services/tenancy` (verification
backlog Issue 1; see `docs/adr/008-merge-identity-and-tenancy.md`,
superseding ADR 004's twelve-module list).

WorkOS-backed authentication: Apple, Google, Microsoft, and email
magic-link sign-in flows. Issues session tokens that authenticate API
calls and carry tenant context. Owns the tenant model and enforces
multi-tenant isolation — row-level security in Postgres, and the boundary
that makes cross-tenant access unrepresentable through any API path.

## Sprint reference

Phase 1, Sprint 1.2 — Identity and authentication
Phase 1, Sprint 1.2.2 — Tenant model and enforcement

## Module contract

This service exports a `ModuleDefinition` (from `@voai/types`). The API
gateway registers it at boot. Other services that need to call this one
import the typed service from `@voai/identity-and-tenancy` — never reach
into internal files.

## Status

Real backend logic implemented for Deliverables 1.2.1 and 1.2.2, scoped to
what's buildable without real WorkOS credentials.

### Implemented

- **`AuthProvider` interface** (`src/auth-provider.ts`) — `signUp`/`signIn`
  accept a sign-in method (`apple | google | microsoft | email_magic_link`)
  and return a session token plus tenant/user identity. This is the seam a
  real WorkOS adapter implements later without any caller changing.
- **`DevAuthProvider`** (`src/dev-auth-provider.ts`) — a dev/test
  implementation of `AuthProvider`. Creates/finds a tenant+user via
  `@voai/db`, issues a SHA-256-hashed bearer token recorded in the new
  `auth_sessions` table. **Not production auth** — no real OAuth
  redirect/callback, no provider-side token verification, no magic-link
  email delivery. `method` is trusted as given by the caller.
- **HTTP routes** (`src/routes.ts`), mounted at
  `/v1/identity-and-tenancy/...` by the gateway: `POST /signup`,
  `POST /signin`, `GET /me` (resolves bearer token → tenant/user via
  `buildTenantContext` from `@voai/auth-context`), `POST /signout`.
- **Tenant model** (`src/tenancy.ts`) — `createTenantWithFounder`,
  `findUserByEmailAcrossTenants`, `getUserInTenant`. All Postgres access
  goes through `db.postgres.withTenant(...)`; no raw queries. Every
  function that operates on an existing tenant takes `tenantContext:
  TenantContext` first, per ADR 007.
- **Migration**
  `packages/db/migrations/1750000000001_identity_and_tenancy.sql` — adds
  `auth_sessions` (issued_at/expires_at/tenant_id/user_id/token_hash),
  named distinctly from the baseline `sessions` table (meeting sessions,
  unrelated concept). RLS enabled and forced, matching the baseline
  pattern.
- **Tests** (`tests/dev-auth-provider.test.ts`, `tests/routes.test.ts`) —
  unit tests for the auth flow against an in-memory fake `PostgresClient`,
  and HTTP-level tests for every route including error-path status codes.

### Deferred — next session's work

- **Real WorkOS integration.** No WorkOS account/credentials are available
  in this environment. A `WorkosAuthProvider` implementing the same
  `AuthProvider` interface plugs in once credentials exist; `routes.ts`
  and everything downstream does not need to change.
- **Live-Postgres integration test** for the auth flow (the pattern in
  `packages/db/tests/integration/tenant-boundary.test.ts` already proves
  RLS isolation generically; an identity-and-tenancy-specific integration
  test was deprioritized in favor of the unit tests above, given time
  constraints).
- Real OAuth/email-magic-link delivery, refresh tokens, and token
  rotation.
