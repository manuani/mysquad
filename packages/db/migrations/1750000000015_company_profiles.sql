-- Up Migration
--
-- Company profiles: a founder running more than one company.
--
-- Until now a tenant *was* a company — `tenants` carries the name alongside
-- plan and status, and signup created exactly one. A founder with two ventures
-- had to choose between mixing both businesses into one brain, where advisors
-- would reason about the wrong company's runway, or keeping two logins.
--
-- The tenant becomes the account: billing, plan, users, and entitlements stay
-- on it. A company profile is a business within that account, and everything
-- that describes a business hangs off the profile — the brain, meetings, and
-- the decision ledger. What each advisor knows is scoped the same way, because
-- it is all derived from those.
--
-- Deliberately not scoped to a profile: users, auth sessions, metering,
-- marketplace bookings, notification preferences. Those belong to the person or
-- the account, not to one of their businesses.

CREATE TABLE company_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  /** One-line description, shown when picking between profiles. */
  description TEXT,
  /** Industry or sector, used as context for the advisors. */
  industry TEXT,
  /**
   * The profile opened by default when the founder signs in. Exactly one per
   * tenant, enforced by a partial unique index below rather than by
   * application code.
   */
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

ALTER TABLE company_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON company_profiles
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE INDEX company_profiles_tenant_idx ON company_profiles (tenant_id);

-- At most one default per tenant. A partial unique index makes this the
-- database's problem rather than something every write path must remember.
CREATE UNIQUE INDEX company_profiles_one_default_per_tenant
  ON company_profiles (tenant_id) WHERE is_default;

-- Every existing tenant becomes an account with one company, named after
-- itself, so nothing that exists today is orphaned.
INSERT INTO company_profiles (tenant_id, name, is_default, created_by)
SELECT t.id,
       t.name,
       true,
       (SELECT u.id FROM users u WHERE u.tenant_id = t.id ORDER BY u.created_at LIMIT 1)
  FROM tenants t
 WHERE EXISTS (SELECT 1 FROM users u WHERE u.tenant_id = t.id);

-- Business context now hangs off the profile. Added nullable, backfilled to
-- each tenant's default, then made NOT NULL — so existing rows land on the
-- company they were always about.
ALTER TABLE brain_content_canonical ADD COLUMN company_profile_id UUID REFERENCES company_profiles(id);
ALTER TABLE sessions               ADD COLUMN company_profile_id UUID REFERENCES company_profiles(id);
ALTER TABLE decisions              ADD COLUMN company_profile_id UUID REFERENCES company_profiles(id);
ALTER TABLE actions                ADD COLUMN company_profile_id UUID REFERENCES company_profiles(id);
ALTER TABLE conflicts              ADD COLUMN company_profile_id UUID REFERENCES company_profiles(id);

UPDATE brain_content_canonical b
   SET company_profile_id = p.id
  FROM company_profiles p
 WHERE p.tenant_id = b.tenant_id AND p.is_default;

UPDATE sessions s
   SET company_profile_id = p.id
  FROM company_profiles p
 WHERE p.tenant_id = s.tenant_id AND p.is_default;

UPDATE decisions d
   SET company_profile_id = p.id
  FROM company_profiles p
 WHERE p.tenant_id = d.tenant_id AND p.is_default;

UPDATE actions a
   SET company_profile_id = p.id
  FROM company_profiles p
 WHERE p.tenant_id = a.tenant_id AND p.is_default;

UPDATE conflicts c
   SET company_profile_id = p.id
  FROM company_profiles p
 WHERE p.tenant_id = c.tenant_id AND p.is_default;

-- Rows whose tenant has no users cannot be attributed to a profile. They are
-- unreachable anyway — no one can sign in to that tenant — so they are left
-- with a NULL profile rather than being deleted here, and the columns stay
-- nullable. Making them NOT NULL would fail on exactly that data, and a
-- migration that cannot run is worse than a column that permits a null nobody
-- writes.

CREATE INDEX brain_content_canonical_profile_idx ON brain_content_canonical (company_profile_id);
CREATE INDEX sessions_profile_idx               ON sessions (company_profile_id);
CREATE INDEX decisions_profile_idx              ON decisions (company_profile_id);
CREATE INDEX actions_profile_idx                ON actions (company_profile_id);
CREATE INDEX conflicts_profile_idx              ON conflicts (company_profile_id);

-- Down Migration

DROP INDEX IF EXISTS conflicts_profile_idx;
DROP INDEX IF EXISTS actions_profile_idx;
DROP INDEX IF EXISTS decisions_profile_idx;
DROP INDEX IF EXISTS sessions_profile_idx;
DROP INDEX IF EXISTS brain_content_canonical_profile_idx;

ALTER TABLE conflicts              DROP COLUMN IF EXISTS company_profile_id;
ALTER TABLE actions                DROP COLUMN IF EXISTS company_profile_id;
ALTER TABLE decisions              DROP COLUMN IF EXISTS company_profile_id;
ALTER TABLE sessions               DROP COLUMN IF EXISTS company_profile_id;
ALTER TABLE brain_content_canonical DROP COLUMN IF EXISTS company_profile_id;

DROP INDEX IF EXISTS company_profiles_one_default_per_tenant;
DROP INDEX IF EXISTS company_profiles_tenant_idx;
DROP TABLE IF EXISTS company_profiles;
