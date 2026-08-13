-- Up Migration
--
-- Meeting briefs: an agenda or background document the founder supplies before
-- a meeting, so advisors arrive knowing what it is about.
--
-- Without one, the first exchange of every meeting is spent establishing
-- context — asked to plan a launch, the advisors each replied with a version
-- of "what is the product?", which is the right question and a poor use of the
-- founder's time when they could have read it beforehand.
--
-- One brief per session, replaceable: re-uploading overwrites rather than
-- accumulating, because a session has one agenda and a founder correcting a
-- typo should not leave two conflicting versions for the advisors to reconcile.
--
-- Content is stored inline rather than in the object store. Briefs are prose
-- of a few kilobytes and are read on every roster call, so a fetch from
-- Postgres in the same tenant-scoped transaction is both simpler and faster
-- than a signed-URL round trip. Attachments large enough to warrant object
-- storage are a later concern; `source_filename` is recorded now so that
-- change does not need a migration.

CREATE TABLE meeting_briefs (
  session_id UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  title TEXT,
  content TEXT NOT NULL,
  /** Original filename when the brief came from a file rather than typed text. */
  source_filename TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Same pattern as every other tenant-scoped table (see baseline.sql): ENABLE
-- alone is insufficient because the migration runner's role owns this table
-- and Postgres exempts table owners from RLS by default. FORCE closes that
-- gap. See ADR 010.
ALTER TABLE meeting_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_briefs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meeting_briefs
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE INDEX meeting_briefs_tenant_idx ON meeting_briefs (tenant_id);

-- Down Migration

DROP INDEX IF EXISTS meeting_briefs_tenant_idx;
DROP TABLE IF EXISTS meeting_briefs;
