/**
 * Meeting briefs — the agenda or background a founder supplies before a
 * meeting so the advisors arrive already knowing what it is about.
 *
 * Without one, the opening exchange of every meeting is spent establishing
 * context. Asked to plan a launch for a named product, each advisor replied
 * with a version of "what is the product, and who is it for?" — the right
 * question, and a poor use of the founder's time when it could have been read
 * beforehand.
 *
 * One brief per session, replaced on re-upload: a session has a single agenda,
 * and a founder fixing a typo should not leave two versions for the advisors
 * to reconcile.
 */

import type { TenantContext } from '@voai/auth-context';
import type { PostgresClient } from '@voai/db';
import { NotFoundError, ValidationError } from '@voai/errors';

export interface MeetingBrief {
  readonly sessionId: string;
  readonly title: string | null;
  readonly content: string;
  readonly sourceFilename: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SaveBriefInput {
  readonly sessionId: string;
  readonly content: string;
  readonly title?: string;
  readonly sourceFilename?: string;
}

/**
 * Briefs are read on every roster call and injected into each persona's prompt,
 * so an unbounded one would inflate the cost and latency of every turn in the
 * meeting. Roughly 15k characters is a long agenda and still a modest share of
 * the context window.
 */
export const MAX_BRIEF_CHARS = 15_000;

interface BriefRow {
  session_id: string;
  title: string | null;
  content: string;
  source_filename: string | null;
  created_at: Date;
  updated_at: Date;
}

function toBrief(row: BriefRow): MeetingBrief {
  return {
    sessionId: row.session_id,
    title: row.title,
    content: row.content,
    sourceFilename: row.source_filename,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function saveBrief(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  input: SaveBriefInput,
): Promise<MeetingBrief> {
  // Guard the id explicitly. A caller that failed to create a session and did
  // not check the response passes undefined straight through, and Postgres
  // reports `invalid input syntax for type uuid: "undefined"` from three frames
  // deeper — which is what a stale mode restriction on session creation
  // actually looked like from here.
  if (!input.sessionId || !/^[0-9a-f-]{36}$/i.test(input.sessionId)) {
    throw new ValidationError(`sessionId must be a session UUID, got: ${String(input.sessionId)}`);
  }

  const content = input.content?.trim();
  if (!content) throw new ValidationError('content is required');
  if (content.length > MAX_BRIEF_CHARS) {
    throw new ValidationError(
      `brief is ${content.length} characters; the maximum is ${MAX_BRIEF_CHARS}`,
    );
  }

  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    // The session must belong to this tenant. RLS would block the insert
    // anyway via the foreign key, but failing here gives the caller a 404
    // rather than a constraint violation.
    const session = await client.query<{ id: string }>(
      'SELECT id FROM sessions WHERE id = $1',
      [input.sessionId],
    );
    if (session.rows.length === 0) {
      throw new NotFoundError(`session ${input.sessionId} not found`);
    }

    const result = await client.query<BriefRow>(
      `INSERT INTO meeting_briefs (session_id, tenant_id, title, content, source_filename, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (session_id) DO UPDATE
         SET title = EXCLUDED.title,
             content = EXCLUDED.content,
             source_filename = EXCLUDED.source_filename,
             updated_at = now()
       RETURNING session_id, title, content, source_filename, created_at, updated_at`,
      [
        input.sessionId,
        tenantContext.tenantId,
        input.title ?? null,
        content,
        input.sourceFilename ?? null,
        tenantContext.userId,
      ],
    );

    return toBrief(result.rows[0]!);
  });
}

export async function getBrief(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  sessionId: string,
): Promise<MeetingBrief | null> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const result = await client.query<BriefRow>(
      `SELECT session_id, title, content, source_filename, created_at, updated_at
       FROM meeting_briefs WHERE session_id = $1`,
      [sessionId],
    );
    return result.rows.length > 0 ? toBrief(result.rows[0]!) : null;
  });
}

export async function deleteBrief(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  sessionId: string,
): Promise<boolean> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const result = await client.query<{ session_id: string }>(
      'DELETE FROM meeting_briefs WHERE session_id = $1 RETURNING session_id',
      [sessionId],
    );
    return result.rows.length > 0;
  });
}
