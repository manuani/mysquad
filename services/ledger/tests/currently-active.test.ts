import { beforeEach, describe, expect, it } from 'vitest';
import type { TenantContext } from '@voai/auth-context';
import { createAction, transitionActionState } from '../src/actions.js';
import { createDecision } from '../src/decisions.js';
import { createConflict } from '../src/conflicts.js';
import { getCurrentlyActive } from '../src/currently-active.js';
import { createFakePostgres } from './fake-postgres.js';

const TENANT_CONTEXT: TenantContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  userType: 'founder',
  sessionId: 'session-1',
};

describe('getCurrentlyActive', () => {
  let postgres: ReturnType<typeof createFakePostgres>['postgres'];

  beforeEach(() => {
    ({ postgres } = createFakePostgres());
  });

  it('aggregates pending/in-progress actions and unresolved conflicts', async () => {
    const pendingAction = await createAction(TENANT_CONTEXT, postgres, { assignedTo: 'founder' });
    const cancelledAction = await createAction(TENANT_CONTEXT, postgres, { assignedTo: 'agent' });
    await transitionActionState(TENANT_CONTEXT, postgres, { actionId: cancelledAction.id, state: 'cancelled' });

    await createDecision(TENANT_CONTEXT, postgres, {
      decisionType: 'pricing',
      summary: 'irrelevant draft',
      stakesLevel: 'low',
    });

    const conflict = await createConflict(TENANT_CONTEXT, postgres, {
      conflictType: 'contradicting_decision',
      sourceAType: 'decision',
      sourceAId: 'decision-a',
      sourceBType: 'decision',
      sourceBId: 'decision-b',
      severity: 'high',
    });

    const view = await getCurrentlyActive(TENANT_CONTEXT, postgres);

    expect(view.pendingOrInProgressActions.map((a) => a.id)).toEqual([pendingAction.id]);
    expect(view.unresolvedConflicts.map((c) => c.id)).toEqual([conflict.id]);
    // The draft decision has no confirmed_at, so it is not outcome-due.
    expect(view.outcomeDueDecisions).toEqual([]);
  });
});
