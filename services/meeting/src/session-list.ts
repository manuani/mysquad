/**
 * Browsing and searching past meetings, so a founder can pick one up again.
 *
 * Conversations are stored and restored, but until now the only way to resume
 * one was to already hold its session id — which meant in practice that a
 * meeting ended and was gone. "Show me last Tuesday's conversation" had no
 * answer.
 *
 * A listing has to say enough to recognise a meeting from a row: when it was,
 * what it was about, who was in it, and how much was said. Titles are rarely
 * supplied, so the summary falls back to the first thing the founder actually
 * said — which is usually a better label than anything they would have typed.
 */

import type { TenantContext } from '@voai/auth-context';
import type { PostgresClient } from '@voai/db';
import type { SessionMode, SessionStatus } from './sessions.js';

export interface MeetingSummary {
  readonly id: string;
  readonly status: SessionStatus;
  readonly mode: SessionMode;
  readonly createdAt: string;
  readonly endedAt: string | null;
  /** Agenda title, when one was uploaded. */
  readonly title: string | null;
  /** The founder's opening line — what the meeting is recognisable by. */
  readonly openingLine: string | null;
  /** Advisors who actually spoke, so the founder sees who was in the room. */
  readonly advisors: readonly string[];
  readonly turnCount: number;
}

export interface ListMeetingsInput {
  /** Free text matched against the agenda and everything said. */
  readonly query?: string;
  readonly limit?: number;
  /**
   * Restricts the list to one of the founder's companies. Omitting it lists
   * every meeting in the account, which is right for an account-level view and
   * wrong for the meeting picker — a founder choosing which conversation to
   * resume is thinking about one business at a time.
   */
  readonly companyProfileId?: string;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/** Enough of the opening line to recognise the meeting, not enough to wrap. */
const OPENING_LINE_CHARS = 140;

interface SummarySqlRow {
  id: string;
  status: SessionStatus;
  mode: SessionMode;
  created_at: Date;
  ended_at: Date | null;
  title: string | null;
  opening_line: string | null;
  advisors: string[] | null;
  turn_count: string;
}

export async function listMeetings(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  input: ListMeetingsInput = {},
): Promise<MeetingSummary[]> {
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const query = input.query?.trim();

  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    // Meetings with nothing in them are not worth showing. A session is created
    // on join, so abandoned joins and test runs would otherwise dominate the
    // list — the founder's own aborted attempts included.
    //
    // Search covers the agenda and everything said in the meeting, because a
    // founder looking for "the pricing conversation" is remembering what was
    // discussed, not what the meeting was called.
    const result = await client.query<SummarySqlRow>(
      `SELECT
         s.id,
         s.status,
         s.mode,
         s.created_at,
         s.ended_at,
         b.title,
         LEFT(
           (SELECT te.content
              FROM transcript_entries te
             WHERE te.session_id = s.id AND te.speaker_type = 'founder'
             ORDER BY te.sequence_number
             LIMIT 1),
           $2
         ) AS opening_line,
         (SELECT ARRAY_AGG(DISTINCT te.speaker_name)
            FROM transcript_entries te
           WHERE te.session_id = s.id AND te.speaker_type = 'agent') AS advisors,
         (SELECT COUNT(*) FROM transcript_entries te WHERE te.session_id = s.id) AS turn_count
       FROM sessions s
       LEFT JOIN meeting_briefs b ON b.session_id = s.id
       WHERE (
         EXISTS (SELECT 1 FROM transcript_entries te WHERE te.session_id = s.id)
         OR b.session_id IS NOT NULL
       )
       AND ($4::uuid IS NULL OR s.company_profile_id = $4)
       AND (
         $3::text IS NULL
         OR b.title ILIKE '%' || $3 || '%'
         OR b.content ILIKE '%' || $3 || '%'
         OR EXISTS (
           SELECT 1 FROM transcript_entries te
            WHERE te.session_id = s.id AND te.content ILIKE '%' || $3 || '%'
         )
       )
       ORDER BY COALESCE(s.ended_at, s.created_at) DESC
       LIMIT $1`,
      [
        limit,
        OPENING_LINE_CHARS,
        query && query.length > 0 ? query : null,
        input.companyProfileId ?? null,
      ],
    );

    return result.rows.map((row) => ({
      id: row.id,
      status: row.status,
      mode: row.mode,
      createdAt: new Date(row.created_at).toISOString(),
      endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
      title: row.title,
      openingLine: row.opening_line,
      advisors: row.advisors ?? [],
      turnCount: Number.parseInt(row.turn_count, 10) || 0,
    }));
  });
}
