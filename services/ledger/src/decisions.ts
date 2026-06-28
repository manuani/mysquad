/**
 * Decision persistence and the four-button conflict-resolution supersession
 * flow.
 *
 * Per the Platform Specification §4.3.3, decisions are append-only — never
 * deleted, only superseded. Every function here that touches tenant data
 * takes `tenantContext: TenantContext` as its first parameter and goes
 * through `db.postgres.withTenant` (ADR 007, packages/db README) — never a
 * raw query.
 */

import type { TenantContext } from '@voai/auth-context';
import type { PostgresClient } from '@voai/db';
import { NotFoundError, ValidationError } from '@voai/errors';

export type DecisionState = 'active' | 'superseded' | 'abandoned' | 'draft';
export type StakesLevel = 'low' | 'medium' | 'high';

/** The four-button conflict resolution outcomes (Platform Specification). */
export type SupersessionMode = 'refines' | 'replaces' | 'parallel' | 'abandons';

export interface DecisionRow {
  readonly id: string;
  readonly tenantId: string;
  readonly meetingId: string | null;
  readonly decisionType: string;
  readonly summary: string;
  readonly rationale: string | null;
  readonly stakesLevel: StakesLevel;
  readonly state: DecisionState;
  readonly confirmedBy: string | null;
  readonly confirmedAt: string | null;
  readonly supersededBy: string | null;
  readonly supersessionReason: string | null;
  readonly outcome: string | null;
  readonly outcomeLoggedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface DecisionSqlRow {
  id: string;
  tenant_id: string;
  meeting_id: string | null;
  decision_type: string;
  summary: string;
  rationale: string | null;
  stakes_level: StakesLevel;
  state: DecisionState;
  confirmed_by: string | null;
  confirmed_at: string | null;
  superseded_by: string | null;
  supersession_reason: string | null;
  outcome: string | null;
  outcome_logged_at: string | null;
  created_at: string;
  updated_at: string;
}

function toDecision(row: DecisionSqlRow): DecisionRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    meetingId: row.meeting_id,
    decisionType: row.decision_type,
    summary: row.summary,
    rationale: row.rationale,
    stakesLevel: row.stakes_level,
    state: row.state,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    supersededBy: row.superseded_by,
    supersessionReason: row.supersession_reason,
    outcome: row.outcome,
    outcomeLoggedAt: row.outcome_logged_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateDecisionInput {
  readonly meetingId?: string | null;
  readonly decisionType: string;
  readonly summary: string;
  readonly rationale?: string | null;
  readonly stakesLevel: StakesLevel;
  readonly state?: DecisionState;
  readonly confirmedBy?: string | null;
}

export async function createDecision(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  input: CreateDecisionInput,
): Promise<DecisionRow> {
  if (!input.summary) throw new ValidationError('summary is required');
  if (!input.decisionType) throw new ValidationError('decisionType is required');

  const state = input.state ?? 'draft';
  const confirmedAt = state === 'active' ? new Date().toISOString() : null;

  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const result = await client.query<DecisionSqlRow>(
      `insert into decisions
        (tenant_id, meeting_id, decision_type, summary, rationale, stakes_level, state, confirmed_by, confirmed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning *`,
      [
        tenantContext.tenantId,
        input.meetingId ?? null,
        input.decisionType,
        input.summary,
        input.rationale ?? null,
        input.stakesLevel,
        state,
        input.confirmedBy ?? null,
        confirmedAt,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('failed to create decision');
    return toDecision(row);
  });
}

export async function getDecision(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  decisionId: string,
): Promise<DecisionRow | null> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const result = await client.query<DecisionSqlRow>('select * from decisions where id = $1', [decisionId]);
    const row = result.rows[0];
    return row ? toDecision(row) : null;
  });
}

export async function listDecisions(
  tenantContext: TenantContext,
  postgres: PostgresClient,
): Promise<DecisionRow[]> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const result = await client.query<DecisionSqlRow>('select * from decisions order by created_at desc', []);
    return result.rows.map(toDecision);
  });
}

/**
 * Decision state transitions. Valid per the Platform Specification's four
 * decision states: a decision starts as Draft, becomes Active on
 * confirmation, and from Active can become Superseded (via the
 * supersession flow below) or Abandoned. There is no path back to Draft,
 * and Superseded/Abandoned are terminal.
 */
const VALID_DECISION_TRANSITIONS: Record<DecisionState, readonly DecisionState[]> = {
  draft: ['active', 'abandoned'],
  active: ['superseded', 'abandoned'],
  superseded: [],
  abandoned: [],
};

function assertValidDecisionTransition(from: DecisionState, to: DecisionState): void {
  if (!VALID_DECISION_TRANSITIONS[from].includes(to)) {
    throw new ValidationError(`cannot transition decision from ${from} to ${to}`);
  }
}

export async function confirmDecision(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  decisionId: string,
  confirmedBy: string,
): Promise<DecisionRow> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const existing = await client.query<DecisionSqlRow>('select * from decisions where id = $1', [decisionId]);
    const existingRow = existing.rows[0];
    if (!existingRow) throw new NotFoundError(`decision ${decisionId} not found`);

    assertValidDecisionTransition(existingRow.state, 'active');

    const result = await client.query<DecisionSqlRow>(
      `update decisions set state = 'active', confirmed_by = $2, confirmed_at = now(), updated_at = now()
       where id = $1
       returning *`,
      [decisionId, confirmedBy],
    );
    const row = result.rows[0];
    if (!row) throw new Error('failed to confirm decision');
    return toDecision(row);
  });
}

export async function abandonDecision(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  decisionId: string,
  reason?: string,
): Promise<DecisionRow> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const existing = await client.query<DecisionSqlRow>('select * from decisions where id = $1', [decisionId]);
    const existingRow = existing.rows[0];
    if (!existingRow) throw new NotFoundError(`decision ${decisionId} not found`);

    assertValidDecisionTransition(existingRow.state, 'abandoned');

    const result = await client.query<DecisionSqlRow>(
      `update decisions set state = 'abandoned', supersession_reason = $2, updated_at = now()
       where id = $1
       returning *`,
      [decisionId, reason ?? null],
    );
    const row = result.rows[0];
    if (!row) throw new Error('failed to abandon decision');
    return toDecision(row);
  });
}

export interface RecordOutcomeInput {
  readonly decisionId: string;
  readonly outcome: string;
}

export async function recordDecisionOutcome(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  input: RecordOutcomeInput,
): Promise<DecisionRow> {
  if (!input.outcome) throw new ValidationError('outcome is required');

  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const existing = await client.query<DecisionSqlRow>('select * from decisions where id = $1', [input.decisionId]);
    const existingRow = existing.rows[0];
    if (!existingRow) throw new NotFoundError(`decision ${input.decisionId} not found`);

    const result = await client.query<DecisionSqlRow>(
      `update decisions set outcome = $2, outcome_logged_at = now(), updated_at = now()
       where id = $1
       returning *`,
      [input.decisionId, input.outcome],
    );
    const row = result.rows[0];
    if (!row) throw new Error('failed to record decision outcome');
    return toDecision(row);
  });
}

export interface SupersedeDecisionInput {
  /** The prior decision being acted on (source A in the conflict, by convention). */
  readonly priorDecisionId: string;
  /**
   * The new decision involved in the resolution. Required for refines and
   * replaces (the new decision must already exist); not used for parallel
   * or abandons.
   */
  readonly newDecisionId?: string;
  readonly mode: SupersessionMode;
  readonly reason?: string;
}

/**
 * The four-button conflict resolution flow (Platform Specification):
 *
 * - Refines: both decisions stay active; the new decision is linked as a
 *   child of the prior one (recorded via supersession_reason on the prior
 *   decision — the prior decision's `superseded_by` is NOT set, since both
 *   remain active per the spec).
 * - Replaces: the prior decision is marked Superseded, linked via
 *   `superseded_by` to the new decision, which remains/becomes Active.
 * - Parallel: both decisions stand independently; no state change to
 *   either decision, but the relationship is recorded for audit purposes
 *   via the reason text on the prior decision.
 * - Abandons: the prior decision is marked Abandoned; there is no
 *   replacement, so `newDecisionId` must not be supplied.
 */
export async function supersedeDecision(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  input: SupersedeDecisionInput,
): Promise<DecisionRow> {
  const { priorDecisionId, newDecisionId, mode, reason } = input;

  if ((mode === 'refines' || mode === 'replaces') && !newDecisionId) {
    throw new ValidationError(`mode ${mode} requires newDecisionId`);
  }
  if (mode === 'abandons' && newDecisionId) {
    throw new ValidationError('mode abandons must not supply newDecisionId');
  }

  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const existing = await client.query<DecisionSqlRow>('select * from decisions where id = $1', [priorDecisionId]);
    const priorRow = existing.rows[0];
    if (!priorRow) throw new NotFoundError(`decision ${priorDecisionId} not found`);

    if (newDecisionId) {
      const newExisting = await client.query<DecisionSqlRow>('select * from decisions where id = $1', [newDecisionId]);
      if (!newExisting.rows[0]) throw new NotFoundError(`decision ${newDecisionId} not found`);
    }

    let updateSql: string;
    let params: unknown[];

    switch (mode) {
      case 'replaces': {
        assertValidDecisionTransition(priorRow.state, 'superseded');
        updateSql = `update decisions set state = 'superseded', superseded_by = $2, supersession_reason = $3, updated_at = now()
                     where id = $1 returning *`;
        params = [priorDecisionId, newDecisionId, reason ?? null];
        break;
      }
      case 'abandons': {
        assertValidDecisionTransition(priorRow.state, 'abandoned');
        updateSql = `update decisions set state = 'abandoned', supersession_reason = $2, updated_at = now()
                     where id = $1 returning *`;
        params = [priorDecisionId, reason ?? null];
        break;
      }
      case 'refines':
      case 'parallel': {
        // Both decisions remain active/independent; only the audit trail
        // (supersession_reason) is recorded on the prior decision.
        updateSql = `update decisions set supersession_reason = $2, updated_at = now()
                     where id = $1 returning *`;
        params = [priorDecisionId, reason ?? `${mode}: linked to ${newDecisionId ?? 'n/a'}`];
        break;
      }
      default:
        throw new ValidationError(`unknown supersession mode: ${String(mode)}`);
    }

    const result = await client.query<DecisionSqlRow>(updateSql, params);
    const row = result.rows[0];
    if (!row) throw new Error('failed to supersede decision');
    return toDecision(row);
  });
}

/** Decisions due for outcome logging: confirmed 6-8 weeks ago, no outcome yet. */
export async function listOutcomeDueDecisions(
  tenantContext: TenantContext,
  postgres: PostgresClient,
): Promise<DecisionRow[]> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const result = await client.query<DecisionSqlRow>(
      `select * from decisions
       where state = 'active'
         and outcome is null
         and confirmed_at is not null
         and confirmed_at <= now() - interval '6 weeks'
       order by confirmed_at asc`,
      [],
    );
    return result.rows.map(toDecision);
  });
}
