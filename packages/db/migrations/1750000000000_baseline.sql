-- Up Migration
--
-- Baseline schema demonstrating the System Architecture §8.1.1 tenant
-- isolation pattern end to end: a tenants table, a users table, and one
-- example tenant-scoped table (sessions) with row-level security applied
-- per §4.2.1's exact pattern. Service modules add their own tables in
-- their own migrations as they're built (Wave 1: identity-and-tenancy,
-- brain, ledger) — this migration only establishes the pattern every
-- later tenant-scoped table follows.

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL,
  user_type TEXT NOT NULL CHECK (user_type IN ('founder', 'admin', 'expert')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

-- ENABLE is not enough on its own: Postgres exempts the table owner from
-- RLS by default, and the migration runner's role owns every table it
-- creates. FORCE closes that gap so the policy applies to every role,
-- owner included — otherwise the application's own connection role
-- (which is typically the owner in a simple single-role setup) would
-- silently bypass the isolation this table exists to enforce.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Example tenant-scoped table, per Architecture §4.2.1's exact pattern.
-- Real meeting/session schema lands with services/meeting (Wave 2); this
-- is deliberately minimal — just enough columns to prove the RLS pattern
-- and to give the seed script and boundary test something concrete to
-- exercise.
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  started_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sessions
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Down Migration

DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS tenants;
