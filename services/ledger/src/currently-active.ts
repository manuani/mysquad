/**
 * The "currently active" aggregate view (Platform Specification): pending/
 * in-progress actions, decisions due for outcome logging, and unresolved
 * conflicts for a tenant. Implemented as a query that composes the other
 * modules' list functions, not a separate table, per the spec.
 *
 * Decay-flagged items are not modeled in this deliverable — decay
 * detection depends on the Brain Service's contradiction/staleness
 * analysis, which is out of scope here (built concurrently in
 * services/brain).
 */

import type { TenantContext } from '@voai/auth-context';
import type { PostgresClient } from '@voai/db';
import { listPendingOrInProgressActions, type ActionRow } from './actions.js';
import { listOutcomeDueDecisions, type DecisionRow } from './decisions.js';
import { listUnresolvedConflicts, type ConflictRow } from './conflicts.js';

export interface CurrentlyActiveView {
  readonly pendingOrInProgressActions: readonly ActionRow[];
  readonly outcomeDueDecisions: readonly DecisionRow[];
  readonly unresolvedConflicts: readonly ConflictRow[];
}

export async function getCurrentlyActive(
  tenantContext: TenantContext,
  postgres: PostgresClient,
): Promise<CurrentlyActiveView> {
  const [pendingOrInProgressActions, outcomeDueDecisions, unresolvedConflicts] = await Promise.all([
    listPendingOrInProgressActions(tenantContext, postgres),
    listOutcomeDueDecisions(tenantContext, postgres),
    listUnresolvedConflicts(tenantContext, postgres),
  ]);

  return { pendingOrInProgressActions, outcomeDueDecisions, unresolvedConflicts };
}
