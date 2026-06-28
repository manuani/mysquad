/**
 * Meeting session lifecycle (Sprint 2.3, Deliverable 2.3.2): started ->
 * active -> ended. Per the Platform Specification, ending a meeting (v1) is
 * always triggered by the founder explicitly ending it — there is no
 * time-based or participant-leave trigger here; those need real-time
 * infra excluded from this deliverable.
 *
 * Every function here that touches tenant data takes `tenantContext:
 * TenantContext` as its first parameter and goes through
 * `postgres.withTenant` (ADR 007, packages/db README) — never a raw query.
 * Modeled on services/ledger/src/decisions.ts's
 * DB-CHECK-constraint-plus-application-guard pattern.
 */

import type { TenantContext } from '@voai/auth-context';
import type { PostgresClient } from '@voai/db';
import { NotFoundError, ValidationError } from '@voai/errors';

export type SessionStatus = 'started' | 'active' | 'ended';
export type SessionMode = 'typed' | 'voice' | 'mixed';

export interface SessionRow {
  readonly id: string;
  readonly tenantId: string;
  readonly startedBy: string;
  readonly status: SessionStatus;
  readonly mode: SessionMode;
  readonly endedAt: string | null;
  readonly createdAt: string;
}

interface SessionSqlRow {
  id: string;
  tenant_id: string;
  started_by: string;
  status: SessionStatus;
  mode: SessionMode;
  ended_at: string | null;
  created_at: string;
}

function toSession(row: SessionSqlRow): SessionRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    startedBy: row.started_by,
    status: row.status,
    mode: row.mode,
    endedAt: row.ended_at,
    createdAt: row.created_at,
  };
}

/**
 * Valid session state transitions. A meeting starts `started`, moves to
 * `active` once the conversation is underway (the first transcript entry
 * does this implicitly — see `appendTranscriptEntry`), and `ended` is
 * terminal. There is no path back from `ended`.
 */
const VALID_SESSION_TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  started: ['active', 'ended'],
  active: ['ended'],
  ended: [],
};

function assertValidSessionTransition(from: SessionStatus, to: SessionStatus): void {
  if (!VALID_SESSION_TRANSITIONS[from].includes(to)) {
    throw new ValidationError(`cannot transition session from ${from} to ${to}`);
  }
}

export interface StartSessionInput {
  readonly mode?: SessionMode;
}

const VALID_MODES: readonly SessionMode[] = ['typed', 'voice', 'mixed'];

export async function startSession(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  input: StartSessionInput = {},
): Promise<SessionRow> {
  const mode = input.mode ?? 'typed';
  if (!VALID_MODES.includes(mode)) {
    throw new ValidationError(`mode must be one of ${VALID_MODES.join(', ')}`);
  }
  if (mode !== 'typed') {
    // Voice/mixed modes need LiveKit/STT/TTS infra deferred from this
    // deliverable (Sprint 2.2 creds not yet available). Accepting the
    // value at the schema level (for forward compatibility) but rejecting
    // it at the application layer until that infra exists avoids a later
    // migration just to widen the CHECK constraint.
    throw new ValidationError(`mode ${mode} is not yet supported; only 'typed' is usable in this deliverable`);
  }

  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const result = await client.query<SessionSqlRow>(
      `insert into sessions (tenant_id, started_by, status, mode)
       values ($1, $2, 'started', $3)
       returning *`,
      [tenantContext.tenantId, tenantContext.userId, mode],
    );
    const row = result.rows[0];
    if (!row) throw new Error('failed to start session');
    return toSession(row);
  });
}

export async function getSession(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  sessionId: string,
): Promise<SessionRow | null> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const result = await client.query<SessionSqlRow>('select * from sessions where id = $1', [sessionId]);
    const row = result.rows[0];
    return row ? toSession(row) : null;
  });
}

async function requireSessionRow(
  client: { query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }> },
  sessionId: string,
): Promise<SessionSqlRow> {
  const result = await client.query<SessionSqlRow>('select * from sessions where id = $1', [sessionId]);
  const row = result.rows[0];
  if (!row) throw new NotFoundError(`session ${sessionId} not found`);
  return row;
}

/**
 * Transitions a `started` session to `active`. Called implicitly by the
 * first transcript entry append (a meeting becomes "active" the moment
 * conversation actually starts) — exposed here too in case a caller wants
 * to mark a session active before any transcript entry exists.
 */
export async function activateSession(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  sessionId: string,
): Promise<SessionRow> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const existingRow = await requireSessionRow(client, sessionId);

    if (existingRow.status === 'active') {
      // Idempotent: already active, nothing to do.
      return toSession(existingRow);
    }
    assertValidSessionTransition(existingRow.status, 'active');

    const result = await client.query<SessionSqlRow>(
      `update sessions set status = 'active' where id = $1 returning *`,
      [sessionId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('failed to activate session');
    return toSession(row);
  });
}

/**
 * Ends a meeting. Per the Platform Specification, this is always an
 * explicit founder action in v1 — there is no automatic end trigger.
 * Application-level guard: cannot end an already-ended session (the CHECK
 * constraint on `status` only validates the enum, not transitions — the
 * transition rule lives here, matching services/ledger's pattern of
 * keeping richer state-transition logic in application code).
 */
export async function endSession(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  sessionId: string,
): Promise<SessionRow> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const existingRow = await requireSessionRow(client, sessionId);

    assertValidSessionTransition(existingRow.status, 'ended');

    const result = await client.query<SessionSqlRow>(
      `update sessions set status = 'ended', ended_at = now() where id = $1 returning *`,
      [sessionId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('failed to end session');
    return toSession(row);
  });
}

/** Exported for use by transcript.ts's append guard without a second DB round-trip pattern leak. */
export function assertSessionAcceptsTranscriptEntries(session: SessionRow): void {
  if (session.status === 'ended') {
    throw new ValidationError(`cannot append transcript entry to ended session ${session.id}`);
  }
}
