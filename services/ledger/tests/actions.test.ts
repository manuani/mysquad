import { beforeEach, describe, expect, it } from 'vitest';
import type { TenantContext } from '@voai/auth-context';
import { ValidationError, NotFoundError } from '@voai/errors';
import {
  createAction,
  transitionActionState,
  listPendingOrInProgressActions,
} from '../src/actions.js';
import { createFakePostgres } from './fake-postgres.js';

const TENANT_CONTEXT: TenantContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  userType: 'founder',
  sessionId: 'session-1',
};

describe('actions lifecycle', () => {
  let postgres: ReturnType<typeof createFakePostgres>['postgres'];

  beforeEach(() => {
    ({ postgres } = createFakePostgres());
  });

  it('creates an action in pending state', async () => {
    const action = await createAction(TENANT_CONTEXT, postgres, { assignedTo: 'founder' });
    expect(action.state).toBe('pending');
    expect(action.assignedTo).toBe('founder');
  });

  it('allows pending -> in_progress -> completed', async () => {
    const action = await createAction(TENANT_CONTEXT, postgres, { assignedTo: 'agent' });
    const inProgress = await transitionActionState(TENANT_CONTEXT, postgres, {
      actionId: action.id,
      state: 'in_progress',
    });
    expect(inProgress.state).toBe('in_progress');

    const completed = await transitionActionState(TENANT_CONTEXT, postgres, {
      actionId: action.id,
      state: 'completed',
    });
    expect(completed.state).toBe('completed');
    expect(completed.completedAt).not.toBeNull();
  });

  it('rejects transitioning a completed action back to pending', async () => {
    const action = await createAction(TENANT_CONTEXT, postgres, { assignedTo: 'agent' });
    await transitionActionState(TENANT_CONTEXT, postgres, {
      actionId: action.id,
      state: 'in_progress',
    });
    await transitionActionState(TENANT_CONTEXT, postgres, {
      actionId: action.id,
      state: 'completed',
    });

    await expect(
      transitionActionState(TENANT_CONTEXT, postgres, { actionId: action.id, state: 'pending' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects transitioning a cancelled action to any other state', async () => {
    const action = await createAction(TENANT_CONTEXT, postgres, { assignedTo: 'agent' });
    await transitionActionState(TENANT_CONTEXT, postgres, {
      actionId: action.id,
      state: 'cancelled',
    });

    await expect(
      transitionActionState(TENANT_CONTEXT, postgres, {
        actionId: action.id,
        state: 'in_progress',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('requires snoozedUntil when transitioning to snoozed', async () => {
    const action = await createAction(TENANT_CONTEXT, postgres, { assignedTo: 'founder' });
    await expect(
      transitionActionState(TENANT_CONTEXT, postgres, { actionId: action.id, state: 'snoozed' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts snoozed with snoozedUntil and allows returning to pending', async () => {
    const action = await createAction(TENANT_CONTEXT, postgres, { assignedTo: 'founder' });
    const snoozeUntil = new Date(Date.now() + 86_400_000).toISOString();
    const snoozed = await transitionActionState(TENANT_CONTEXT, postgres, {
      actionId: action.id,
      state: 'snoozed',
      snoozedUntil: snoozeUntil,
    });
    expect(snoozed.state).toBe('snoozed');
    expect(snoozed.snoozedUntil).toBe(snoozeUntil);

    const backToPending = await transitionActionState(TENANT_CONTEXT, postgres, {
      actionId: action.id,
      state: 'pending',
    });
    expect(backToPending.state).toBe('pending');
  });

  it('requires delegatedToExpertId when transitioning to delegated_to_expert', async () => {
    const action = await createAction(TENANT_CONTEXT, postgres, { assignedTo: 'founder' });
    await expect(
      transitionActionState(TENANT_CONTEXT, postgres, {
        actionId: action.id,
        state: 'delegated_to_expert',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts delegated_to_expert with delegatedToExpertId', async () => {
    const action = await createAction(TENANT_CONTEXT, postgres, { assignedTo: 'founder' });
    const delegated = await transitionActionState(TENANT_CONTEXT, postgres, {
      actionId: action.id,
      state: 'delegated_to_expert',
      delegatedToExpertId: 'expert-1',
    });
    expect(delegated.state).toBe('delegated_to_expert');
    expect(delegated.delegatedToExpertId).toBe('expert-1');
  });

  it('blocked_reason is optional when transitioning to blocked', async () => {
    const action = await createAction(TENANT_CONTEXT, postgres, { assignedTo: 'founder' });
    const blocked = await transitionActionState(TENANT_CONTEXT, postgres, {
      actionId: action.id,
      state: 'blocked',
    });
    expect(blocked.state).toBe('blocked');
    expect(blocked.blockedReason).toBeNull();
  });

  it('throws NotFoundError for an unknown action id', async () => {
    await expect(
      transitionActionState(TENANT_CONTEXT, postgres, {
        actionId: 'no-such-id',
        state: 'in_progress',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('listPendingOrInProgressActions returns only pending/in_progress actions', async () => {
    const a = await createAction(TENANT_CONTEXT, postgres, { assignedTo: 'founder' });
    const b = await createAction(TENANT_CONTEXT, postgres, { assignedTo: 'agent' });
    await transitionActionState(TENANT_CONTEXT, postgres, { actionId: b.id, state: 'cancelled' });

    const active = await listPendingOrInProgressActions(TENANT_CONTEXT, postgres);
    expect(active.map((row) => row.id)).toEqual([a.id]);
  });
});
