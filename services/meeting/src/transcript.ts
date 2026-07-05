/**
 * Transcript persistence: the ordered sequence of what was said in a
 * meeting, attributed to founder or agent. Per Sprint 2.3.2, typed mode
 * only — entries are appended directly via the API, no STT pipeline.
 *
 * Every function here that touches tenant data takes `tenantContext:
 * TenantContext` as its first parameter and goes through
 * `postgres.withTenant` (ADR 007) — never a raw query.
 */

import type { TenantContext } from '@voai/auth-context';
import type { PostgresClient } from '@voai/db';
import { NotFoundError, ValidationError } from '@voai/errors';
import {
  assertSessionAcceptsTranscriptEntries,
  type SessionRow,
  type SessionStatus,
} from './sessions.js';

export type SpeakerType = 'founder' | 'agent';

export interface TranscriptEntryRow {
  readonly id: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly sequenceNumber: number;
  readonly speakerType: SpeakerType;
  readonly speakerName: string;
  readonly content: string;
  readonly createdAt: string;
}

interface TranscriptEntrySqlRow {
  id: string;
  tenant_id: string;
  session_id: string;
  sequence_number: number;
  speaker_type: SpeakerType;
  speaker_name: string;
  content: string;
  created_at: string;
}

interface SessionSqlRow {
  id: string;
  tenant_id: string;
  started_by: string;
  status: SessionStatus;
  mode: string;
  ended_at: string | null;
  created_at: string;
}

function toTranscriptEntry(row: TranscriptEntrySqlRow): TranscriptEntryRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sessionId: row.session_id,
    sequenceNumber: row.sequence_number,
    speakerType: row.speaker_type,
    speakerName: row.speaker_name,
    content: row.content,
    createdAt: row.created_at,
  };
}

function toSession(row: SessionSqlRow): SessionRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    startedBy: row.started_by,
    status: row.status,
    mode: row.mode as SessionRow['mode'],
    endedAt: row.ended_at,
    createdAt: row.created_at,
  };
}

const SPEAKER_TYPES: readonly SpeakerType[] = ['founder', 'agent'];

export interface AppendTranscriptEntryInput {
  readonly sessionId: string;
  readonly speakerType: SpeakerType;
  readonly speakerName: string;
  readonly content: string;
}

/**
 * Appends one transcript entry, assigning the next sequence_number for the
 * session. Guards: the session must exist and must not already be ended
 * (services/ledger pattern — application-level guard alongside the DB
 * CHECK constraint that only validates the status enum, not transitions).
 * The first entry appended to a `started` session implicitly activates it
 * — a meeting becomes "active" the moment conversation starts.
 */
export async function appendTranscriptEntry(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  input: AppendTranscriptEntryInput,
): Promise<TranscriptEntryRow> {
  if (!SPEAKER_TYPES.includes(input.speakerType)) {
    throw new ValidationError(`speakerType must be one of ${SPEAKER_TYPES.join(', ')}`);
  }
  if (!input.speakerName) throw new ValidationError('speakerName is required');
  if (!input.content) throw new ValidationError('content is required');

  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const sessionResult = await client.query<SessionSqlRow>(
      'select * from sessions where id = $1',
      [input.sessionId],
    );
    const sessionRow = sessionResult.rows[0];
    if (!sessionRow) throw new NotFoundError(`session ${input.sessionId} not found`);
    const session = toSession(sessionRow);

    assertSessionAcceptsTranscriptEntries(session);

    if (session.status === 'started') {
      await client.query(`update sessions set status = 'active' where id = $1`, [input.sessionId]);
    }

    const seqResult = await client.query<{ next_seq: number }>(
      'select coalesce(max(sequence_number), 0) + 1 as next_seq from transcript_entries where session_id = $1',
      [input.sessionId],
    );
    const nextSeq = seqResult.rows[0]?.next_seq ?? 1;

    const result = await client.query<TranscriptEntrySqlRow>(
      `insert into transcript_entries
        (tenant_id, session_id, sequence_number, speaker_type, speaker_name, content)
       values ($1, $2, $3, $4, $5, $6)
       returning *`,
      [
        tenantContext.tenantId,
        input.sessionId,
        nextSeq,
        input.speakerType,
        input.speakerName,
        input.content,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('failed to append transcript entry');
    return toTranscriptEntry(row);
  });
}

/** Reads the full transcript for a session, in order. */
export async function getTranscript(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  sessionId: string,
): Promise<TranscriptEntryRow[]> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const sessionResult = await client.query<SessionSqlRow>(
      'select * from sessions where id = $1',
      [sessionId],
    );
    if (!sessionResult.rows[0]) throw new NotFoundError(`session ${sessionId} not found`);

    const result = await client.query<TranscriptEntrySqlRow>(
      'select * from transcript_entries where session_id = $1 order by sequence_number asc',
      [sessionId],
    );
    return result.rows.map(toTranscriptEntry);
  });
}
