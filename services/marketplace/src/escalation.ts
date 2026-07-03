import type { TenantContext } from '@voai/auth-context';
import type { TenantScopedClient } from '@voai/db';
import { NotFoundError } from '@voai/errors';

export interface EscalationEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly personaName: string;
  readonly topic: string;
  readonly suggestedExpertId: string | null;
  readonly status: 'suggested' | 'accepted' | 'dismissed';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateEscalationInput {
  readonly sessionId: string;
  readonly personaName: string;
  readonly topic: string;
  readonly suggestedExpertId?: string;
}

function rowToEvent(row: Record<string, unknown>): EscalationEvent {
  return {
    id: row['id'] as string,
    tenantId: row['tenant_id'] as string,
    sessionId: row['session_id'] as string,
    personaName: row['persona_name'] as string,
    topic: row['topic'] as string,
    suggestedExpertId: (row['suggested_expert_id'] as string | null) ?? null,
    status: row['status'] as EscalationEvent['status'],
    createdAt: (row['created_at'] as Date).toISOString(),
    updatedAt: (row['updated_at'] as Date).toISOString(),
  };
}

export async function recordEscalation(
  tc: TenantContext,
  client: TenantScopedClient,
  input: CreateEscalationInput,
): Promise<EscalationEvent> {
  const { rows } = await client.query<Record<string, unknown>>(
    `INSERT INTO escalation_events (tenant_id, session_id, persona_name, topic, suggested_expert_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [tc.tenantId, input.sessionId, input.personaName, input.topic, input.suggestedExpertId ?? null],
  );
  return rowToEvent(rows[0]!);
}

export async function updateEscalationStatus(
  _tc: TenantContext,
  client: TenantScopedClient,
  escalationId: string,
  status: 'accepted' | 'dismissed',
): Promise<EscalationEvent> {
  const { rows } = await client.query<Record<string, unknown>>(
    `UPDATE escalation_events SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [status, escalationId],
  );
  if (!rows[0]) throw new NotFoundError(`escalation ${escalationId} not found`);
  return rowToEvent(rows[0]);
}

export async function getSessionEscalations(
  tc: TenantContext,
  client: TenantScopedClient,
  sessionId: string,
): Promise<EscalationEvent[]> {
  const { rows } = await client.query<Record<string, unknown>>(
    `SELECT * FROM escalation_events
     WHERE tenant_id = $1 AND session_id = $2
     ORDER BY created_at DESC`,
    [tc.tenantId, sessionId],
  );
  return rows.map(rowToEvent);
}
