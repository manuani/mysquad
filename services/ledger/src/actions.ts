/**
 * Action persistence and lifecycle state-transition enforcement.
 *
 * Seven action lifecycle states (v1), per the Platform Specification:
 * Pending, In Progress, Completed, Cancelled, Blocked (optional
 * blocked_reason), Snoozed (required snoozed_until), Delegated_to_expert
 * (required delegated_to_expert_id). Delegated_to_team_member is deferred
 * to v2 and intentionally not modeled here.
 *
 * Every function here that touches tenant data takes `tenantContext:
 * TenantContext` as its first parameter and goes through
 * `db.postgres.withTenant` — never a raw query (ADR 007).
 */

import type { TenantContext } from '@voai/auth-context';
import type { PostgresClient } from '@voai/db';
import { NotFoundError, ValidationError } from '@voai/errors';

export type ActionState =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'blocked'
  | 'snoozed'
  | 'delegated_to_expert';

export type AssignedTo = 'founder' | 'agent' | 'expert';

export interface ActionRow {
  readonly id: string;
  readonly tenantId: string;
  readonly decisionId: string | null;
  readonly assignedTo: AssignedTo;
  readonly state: ActionState;
  readonly dueAt: string | null;
  readonly blockedReason: string | null;
  readonly snoozedUntil: string | null;
  readonly delegatedToExpertId: string | null;
  readonly completedAt: string | null;
  readonly outcome: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface ActionSqlRow {
  id: string;
  tenant_id: string;
  decision_id: string | null;
  assigned_to: AssignedTo;
  state: ActionState;
  due_at: string | null;
  blocked_reason: string | null;
  snoozed_until: string | null;
  delegated_to_expert_id: string | null;
  completed_at: string | null;
  outcome: string | null;
  created_at: string;
  updated_at: string;
}

function toAction(row: ActionSqlRow): ActionRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    decisionId: row.decision_id,
    assignedTo: row.assigned_to,
    state: row.state,
    dueAt: row.due_at,
    blockedReason: row.blocked_reason,
    snoozedUntil: row.snoozed_until,
    delegatedToExpertId: row.delegated_to_expert_id,
    completedAt: row.completed_at,
    outcome: row.outcome,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Valid action state transitions. Terminal states (Completed, Cancelled)
 * have no outgoing transitions — e.g. an action cannot go from Completed
 * back to Pending. Blocked/Snoozed/Delegated_to_expert are "paused" states
 * that can return to Pending/In Progress or move on to a terminal state.
 */
const VALID_ACTION_TRANSITIONS: Record<ActionState, readonly ActionState[]> = {
  pending: ['in_progress', 'cancelled', 'blocked', 'snoozed', 'delegated_to_expert'],
  in_progress: ['completed', 'cancelled', 'blocked', 'snoozed', 'delegated_to_expert'],
  blocked: ['pending', 'in_progress', 'cancelled'],
  snoozed: ['pending', 'in_progress', 'cancelled'],
  delegated_to_expert: ['pending', 'in_progress', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function assertValidActionTransition(from: ActionState, to: ActionState): void {
  if (!VALID_ACTION_TRANSITIONS[from].includes(to)) {
    throw new ValidationError(`cannot transition action from ${from} to ${to}`);
  }
}

export interface CreateActionInput {
  readonly decisionId?: string | null;
  readonly assignedTo: AssignedTo;
  readonly dueAt?: string | null;
}

export async function createAction(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  input: CreateActionInput,
): Promise<ActionRow> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const result = await client.query<ActionSqlRow>(
      `insert into actions (tenant_id, decision_id, assigned_to, state, due_at)
       values ($1, $2, $3, 'pending', $4)
       returning *`,
      [tenantContext.tenantId, input.decisionId ?? null, input.assignedTo, input.dueAt ?? null],
    );
    const row = result.rows[0];
    if (!row) throw new Error('failed to create action');
    return toAction(row);
  });
}

export async function getAction(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  actionId: string,
): Promise<ActionRow | null> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const result = await client.query<ActionSqlRow>('select * from actions where id = $1', [
      actionId,
    ]);
    const row = result.rows[0];
    return row ? toAction(row) : null;
  });
}

export async function listActions(
  tenantContext: TenantContext,
  postgres: PostgresClient,
): Promise<ActionRow[]> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const result = await client.query<ActionSqlRow>(
      'select * from actions order by created_at desc',
      [],
    );
    return result.rows.map(toAction);
  });
}

export interface TransitionActionStateInput {
  readonly actionId: string;
  readonly state: ActionState;
  readonly blockedReason?: string | null;
  readonly snoozedUntil?: string | null;
  readonly delegatedToExpertId?: string | null;
  readonly outcome?: string | null;
}

function validateStateRequirements(input: TransitionActionStateInput): void {
  if (input.state === 'blocked') {
    // blocked_reason is optional per the spec ("optional blocked_reason").
  }
  if (input.state === 'snoozed' && !input.snoozedUntil) {
    throw new ValidationError('snoozedUntil is required when transitioning to snoozed');
  }
  if (input.state === 'delegated_to_expert' && !input.delegatedToExpertId) {
    throw new ValidationError(
      'delegatedToExpertId is required when transitioning to delegated_to_expert',
    );
  }
}

/**
 * Transitions an action to a new state, enforcing both the state-machine
 * validity (assertValidActionTransition) and the required-field
 * invariants (validateStateRequirements) before writing. The DB-level
 * CHECK constraints in the migration are a second line of defense, not the
 * only one — this is where the richer transition rules live.
 */
export async function transitionActionState(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  input: TransitionActionStateInput,
): Promise<ActionRow> {
  validateStateRequirements(input);

  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const existing = await client.query<ActionSqlRow>('select * from actions where id = $1', [
      input.actionId,
    ]);
    const existingRow = existing.rows[0];
    if (!existingRow) throw new NotFoundError(`action ${input.actionId} not found`);

    assertValidActionTransition(existingRow.state, input.state);

    const completedAt = input.state === 'completed' ? new Date().toISOString() : null;
    const blockedReason = input.state === 'blocked' ? (input.blockedReason ?? null) : null;
    const snoozedUntil = input.state === 'snoozed' ? (input.snoozedUntil ?? null) : null;
    const delegatedToExpertId =
      input.state === 'delegated_to_expert' ? (input.delegatedToExpertId ?? null) : null;

    const result = await client.query<ActionSqlRow>(
      `update actions set
        state = $2,
        blocked_reason = $3,
        snoozed_until = $4,
        delegated_to_expert_id = $5,
        completed_at = $6,
        outcome = coalesce($7, outcome),
        updated_at = now()
       where id = $1
       returning *`,
      [
        input.actionId,
        input.state,
        blockedReason,
        snoozedUntil,
        delegatedToExpertId,
        completedAt,
        input.outcome ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('failed to transition action');
    return toAction(row);
  });
}

/** Pending or in-progress actions for the "currently active" aggregate view. */
export async function listPendingOrInProgressActions(
  tenantContext: TenantContext,
  postgres: PostgresClient,
): Promise<ActionRow[]> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const result = await client.query<ActionSqlRow>(
      `select * from actions where state in ('pending', 'in_progress') order by due_at asc nulls last`,
      [],
    );
    return result.rows.map(toAction);
  });
}
