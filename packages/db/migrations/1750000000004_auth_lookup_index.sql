-- Up Migration
--
-- Fixes a real bug found by exercising the identity-and-tenancy module end
-- to end against the live RLS-enforced database: `resolveSession` (by
-- token) and `findUserByEmailAcrossTenants` (by email, used at sign-in)
-- both need to discover *which tenant* a credential belongs to before
-- they know what to pass to `withTenant`. But `withTenant` only grants
-- visibility into rows that already match the tenant you scope into — so
-- there was no way to find that tenant_id in the first place. Both
-- functions previously scoped to `SYSTEM_TENANT` and queried `auth_sessions`
-- / `users` directly; RLS correctly hid every row belonging to a real
-- tenant, so the query silently returned zero rows. Confirmed broken: a
-- founder could sign up, but never resolve their session or sign back in.
--
-- Fix: two minimal, deliberately non-RLS index tables. They hold nothing
-- but a credential identifier and the tenant_id it belongs to — the same
-- non-RLS exception already made for `tenants` itself (the root table
-- everything else hangs off, per the baseline migration's comment). The
-- actual session/user data stays fully RLS-protected; these tables exist
-- only to answer "which tenant do I scope into next."

CREATE TABLE email_tenant_index (
  email TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth_session_tenant_index (
  token_hash TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE IF EXISTS auth_session_tenant_index;
DROP TABLE IF EXISTS email_tenant_index;
