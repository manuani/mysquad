-- Up Migration
--
-- Ledger Service schema (Sprint 3.2, Deliverable 3.2.1: Ledger schema and
-- lifecycle). Per System Architecture §4.3.3 and Platform Specification:
-- the ledger captures decisions, actions, and conflicts with rationale and
-- history.
--
-- Scope of this migration: backend storage only, matching the scope of the
-- accompanying @voai/ledger module work (CRUD + state-transition API, no
-- end-of-meeting extraction — that needs services/meeting, which doesn't
-- exist yet).
--
-- All three tables are tenant-scoped (organisation_id in the platform spec
-- maps to tenant_id, matching the column name every other tenant-scoped
-- table in this schema uses — see baseline.sql and
-- identity_and_tenancy.sql). Same RLS pattern as those migrations: ENABLE
-- alone is insufficient because the migration runner's role owns these
-- tables and Postgres exempts table owners from RLS by default. FORCE
-- closes that gap. See ADR 010 for why this is load-bearing, not cosmetic.

-- Decisions are append-only — never deleted, only superseded via the
-- `superseded_by` self-reference and `supersession_reason`. Four decision
-- states per the Platform Specification: Active, Superseded, Abandoned,
-- Draft.
CREATE TABLE decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  -- Nullable: a decision can exist outside any specific meeting (e.g.
  -- created directly through the API). Meeting linkage is informational
  -- only here — no FK to a meetings table, since services/meeting does not
  -- exist yet.
  meeting_id UUID,
  decision_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  rationale TEXT,
  stakes_level TEXT NOT NULL CHECK (stakes_level IN ('low', 'medium', 'high')),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('active', 'superseded', 'abandoned', 'draft')),
  confirmed_by UUID REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  superseded_by UUID REFERENCES decisions(id),
  supersession_reason TEXT,
  outcome TEXT,
  outcome_logged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON decisions
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Actions: seven lifecycle states (v1) per the Platform Specification.
-- Delegated_to_team_member is explicitly deferred to v2 and is NOT a valid
-- state here. blocked_reason is required when state = 'blocked';
-- snoozed_until is required when state = 'snoozed'; delegated_to_expert_id
-- is required when state = 'delegated_to_expert'. These cross-field
-- requirements are enforced in application code (see src/actions.ts) in
-- addition to the CHECK constraints below, which only validate the state
-- enum itself — Postgres CHECK constraints can express the conditional
-- requirements too, but keeping the invariant in one place (application
-- code) alongside the richer state-transition rules keeps the two from
-- drifting out of sync.
CREATE TABLE actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  decision_id UUID REFERENCES decisions(id),
  assigned_to TEXT NOT NULL CHECK (assigned_to IN ('founder', 'agent', 'expert')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (
    state IN (
      'pending',
      'in_progress',
      'completed',
      'cancelled',
      'blocked',
      'snoozed',
      'delegated_to_expert'
    )
  ),
  due_at TIMESTAMPTZ,
  blocked_reason TEXT,
  snoozed_until TIMESTAMPTZ,
  delegated_to_expert_id UUID,
  completed_at TIMESTAMPTZ,
  outcome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT blocked_reason_requires_blocked_state CHECK (
    state = 'blocked' OR blocked_reason IS NULL
  ),
  CONSTRAINT snoozed_until_required_when_snoozed CHECK (
    (state = 'snoozed' AND snoozed_until IS NOT NULL) OR state != 'snoozed'
  ),
  CONSTRAINT delegated_expert_required_when_delegated CHECK (
    (state = 'delegated_to_expert' AND delegated_to_expert_id IS NOT NULL) OR state != 'delegated_to_expert'
  )
);

ALTER TABLE actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE actions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON actions
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Conflicts: detected contradictions between two sources (a decision, an
-- action, or some other artifact type), tracked through a resolution state
-- machine (Detected -> Acknowledged -> Resolved) and resolved via one of
-- the four-button supersession outcomes (Refines, Replaces, Parallel,
-- Abandons) recorded in resolution_note.
CREATE TABLE conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  conflict_type TEXT NOT NULL,
  source_a_type TEXT NOT NULL,
  source_a_id UUID NOT NULL,
  source_b_type TEXT NOT NULL,
  source_b_id UUID NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  resolution_state TEXT NOT NULL DEFAULT 'detected' CHECK (
    resolution_state IN ('detected', 'acknowledged', 'resolved')
  ),
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT
);

ALTER TABLE conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE conflicts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON conflicts
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE INDEX decisions_tenant_state_idx ON decisions (tenant_id, state);
CREATE INDEX actions_tenant_state_idx ON actions (tenant_id, state);
CREATE INDEX conflicts_tenant_resolution_state_idx ON conflicts (tenant_id, resolution_state);

-- Down Migration

DROP TABLE IF EXISTS conflicts;
DROP TABLE IF EXISTS actions;
DROP TABLE IF EXISTS decisions;
