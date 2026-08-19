-- Up Migration
--
-- Documents handed to the team, before a meeting or during one.
--
-- Distinct from `meeting_briefs`, which is one agenda per session, replaced on
-- re-upload, and read as standing context on every turn. Shared material is a
-- sequence of things handed over at points in time, and the differences matter:
--
--   * There can be several in one meeting.
--   * When it arrived is part of its meaning. A document handed over at turn ten
--     must not read as though the team had it from the start — that would make
--     their earlier answers look negligent and misrepresent what they knew. So
--     each row records the transcript position it arrived at.
--   * It may not be a file. A founder mid-meeting is as likely to paste a link
--     or a paragraph of an email, which is why `filename` is nullable and the
--     text is what matters.
--
-- Extracted text is stored rather than the original bytes. It is what the
-- advisors read, it is searchable, and keeping multi-megabyte decks in Postgres
-- to re-parse them later is a cost without a current use. `filename` and
-- `content_type` are recorded so moving originals to the object store later
-- needs no migration.

CREATE TABLE meeting_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  /** Null when the founder pasted text rather than attaching a file. */
  filename TEXT,
  /** 'pdf', 'docx', 'pptx', 'markdown', 'text', or 'pasted'. */
  kind TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  /** Pages or slides, where the format has them. */
  sections INTEGER,
  /**
   * Which transcript entry this arrived after. Null means it was supplied
   * before the meeting began. This is what lets the advisors treat a document
   * as new information rather than as something they should always have known.
   */
  shared_after_sequence INTEGER,
  shared_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE meeting_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meeting_documents
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE INDEX meeting_documents_session_idx ON meeting_documents (session_id, created_at);

-- Down Migration

DROP INDEX IF EXISTS meeting_documents_session_idx;
DROP TABLE IF EXISTS meeting_documents;
