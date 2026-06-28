/**
 * Conflict persistence and resolution.
 *
 * Conflicts are detected contradictions between two sources (decisions,
 * actions, or other artifact types — `sourceAType`/`sourceBType` are free
 * text rather than a closed enum since the set of conflict-detectable
 * artifact types grows as later services land). Resolution state machine:
 * Detected -> Acknowledged -> Resolved.
 *
 * Every function here that touches tenant data takes `tenantContext:
 * TenantContext` as its first parameter and goes through
 * `db.postgres.withTenant` — never a raw query (ADR 007).
 */

import type { TenantContext } from '@voai/auth-context';
import type { PostgresClient } from '@voai/db';
import { NotFoundError, ValidationError } from '@voai/errors';

export type ConflictSeverity = 'low' | 'medium' | 'high';
export type ConflictResolutionState = 'detected' | 'acknowledged' | 'resolved';

export interface ConflictRow {
  readonly id: string;
  readonly tenantId: string;
  readonly conflictType: string;
  readonly sourceAType: string;
  readonly sourceAId: string;
  readonly sourceBType: string;
  readonly sourceBId: string;
  readonly detectedAt: string;
  readonly severity: ConflictSeverity;
  readonly resolutionState: ConflictResolutionState;
  readonly resolvedBy: string | null;
  readonly resolvedAt: string | null;
  readonly resolutionNote: string | null;
}

interface ConflictSqlRow {
  id: string;
  tenant_id: string;
  conflict_type: string;
  source_a_type: string;
  source_a_id: string;
  source_b_type: string;
  source_b_id: string;
  detected_at: string;
  severity: ConflictSeverity;
  resolution_state: ConflictResolutionState;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
}

function toConflict(row: ConflictSqlRow): ConflictRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    conflictType: row.conflict_type,
    sourceAType: row.source_a_type,
    sourceAId: row.source_a_id,
    sourceBType: row.source_b_type,
    sourceBId: row.source_b_id,
    detectedAt: row.detected_at,
    severity: row.severity,
    resolutionState: row.resolution_state,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
  };
}

export interface CreateConflictInput {
  readonly conflictType: string;
  readonly sourceAType: string;
  readonly sourceAId: string;
  readonly sourceBType: string;
  readonly sourceBId: string;
  readonly severity: ConflictSeverity;
}

export async function createConflict(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  input: CreateConflictInput,
): Promise<ConflictRow> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const result = await client.query<ConflictSqlRow>(
      `insert into conflicts (tenant_id, conflict_type, source_a_type, source_a_id, source_b_type, source_b_id, severity)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning *`,
      [
        tenantContext.tenantId,
        input.conflictType,
        input.sourceAType,
        input.sourceAId,
        input.sourceBType,
        input.sourceBId,
        input.severity,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('failed to create conflict');
    return toConflict(row);
  });
}

export async function getConflict(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  conflictId: string,
): Promise<ConflictRow | null> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const result = await client.query<ConflictSqlRow>('select * from conflicts where id = $1', [conflictId]);
    const row = result.rows[0];
    return row ? toConflict(row) : null;
  });
}

export async function listUnresolvedConflicts(
  tenantContext: TenantContext,
  postgres: PostgresClient,
): Promise<ConflictRow[]> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const result = await client.query<ConflictSqlRow>(
      `select * from conflicts where resolution_state != 'resolved' order by detected_at desc`,
      [],
    );
    return result.rows.map(toConflict);
  });
}

const VALID_RESOLUTION_TRANSITIONS: Record<ConflictResolutionState, readonly ConflictResolutionState[]> = {
  detected: ['acknowledged', 'resolved'],
  acknowledged: ['resolved'],
  resolved: [],
};

function assertValidResolutionTransition(from: ConflictResolutionState, to: ConflictResolutionState): void {
  if (!VALID_RESOLUTION_TRANSITIONS[from].includes(to)) {
    throw new ValidationError(`cannot transition conflict from ${from} to ${to}`);
  }
}

export async function acknowledgeConflict(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  conflictId: string,
): Promise<ConflictRow> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const existing = await client.query<ConflictSqlRow>('select * from conflicts where id = $1', [conflictId]);
    const existingRow = existing.rows[0];
    if (!existingRow) throw new NotFoundError(`conflict ${conflictId} not found`);

    assertValidResolutionTransition(existingRow.resolution_state, 'acknowledged');

    const result = await client.query<ConflictSqlRow>(
      `update conflicts set resolution_state = 'acknowledged' where id = $1 returning *`,
      [conflictId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('failed to acknowledge conflict');
    return toConflict(row);
  });
}

export interface ResolveConflictInput {
  readonly conflictId: string;
  readonly resolvedBy: string;
  /** Free-text capturing which of the four-button outcomes was chosen (refines/replaces/parallel/abandons) and any additional rationale. */
  readonly resolutionNote: string;
}

/**
 * Resolves a conflict. This is the conflict-table side of the four-button
 * resolution flow; the corresponding state change to the underlying
 * decisions (Refines/Replaces/Parallel/Abandons) is applied separately via
 * `supersedeDecision` in decisions.ts when the conflict's sources are
 * decisions. Keeping the two operations separate (rather than conflating
 * "resolve the conflict record" with "mutate the decision") means a
 * conflict between two actions, or between a decision and a future
 * artifact type, can be resolved through this same function without a
 * decision-specific side effect being forced on it.
 */
export async function resolveConflict(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  input: ResolveConflictInput,
): Promise<ConflictRow> {
  if (!input.resolutionNote) throw new ValidationError('resolutionNote is required');

  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const existing = await client.query<ConflictSqlRow>('select * from conflicts where id = $1', [input.conflictId]);
    const existingRow = existing.rows[0];
    if (!existingRow) throw new NotFoundError(`conflict ${input.conflictId} not found`);

    assertValidResolutionTransition(existingRow.resolution_state, 'resolved');

    const result = await client.query<ConflictSqlRow>(
      `update conflicts set resolution_state = 'resolved', resolved_by = $2, resolved_at = now(), resolution_note = $3
       where id = $1
       returning *`,
      [input.conflictId, input.resolvedBy, input.resolutionNote],
    );
    const row = result.rows[0];
    if (!row) throw new Error('failed to resolve conflict');
    return toConflict(row);
  });
}
