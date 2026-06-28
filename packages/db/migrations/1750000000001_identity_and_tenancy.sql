-- Up Migration
--
-- Identity and Tenancy service schema (Sprint 1.2, Deliverables 1.2.1 and
-- 1.2.2). The baseline migration (1750000000000_baseline.sql) already
-- creates `tenants`, `users`, and `sessions` (meeting sessions). This
-- migration adds the auth-session-token table this service needs to issue
-- and validate session tokens.
--
-- Deliberately named `auth_sessions`, not `sessions` — the baseline
-- `sessions` table is for meeting sessions (System Architecture §4.2.1
-- example), a completely different concept. Conflating the two by reusing
-- the name would make a future join or migration ambiguous.

CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  -- Opaque bearer token handed to the client; only its hash is stored so a
  -- leaked database snapshot does not also leak usable session tokens.
  token_hash TEXT NOT NULL UNIQUE,
  sign_in_method TEXT NOT NULL CHECK (
    sign_in_method IN ('apple', 'google', 'microsoft', 'email_magic_link')
  ),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX auth_sessions_token_hash_idx ON auth_sessions (token_hash);

-- Same RLS pattern as the baseline migration: ENABLE alone is insufficient
-- because the migration runner's role owns this table and Postgres exempts
-- table owners from RLS by default. FORCE closes that gap. See ADR 010 for
-- why this is load-bearing rather than cosmetic.
ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON auth_sessions
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Down Migration

DROP TABLE IF EXISTS auth_sessions;
