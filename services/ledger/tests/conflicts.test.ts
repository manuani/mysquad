import { beforeEach, describe, expect, it } from 'vitest';
import type { TenantContext } from '@voai/auth-context';
import { NotFoundError, ValidationError } from '@voai/errors';
import { acknowledgeConflict, createConflict, listUnresolvedConflicts, resolveConflict } from '../src/conflicts.js';
import { createFakePostgres } from './fake-postgres.js';

const TENANT_CONTEXT: TenantContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  userType: 'founder',
  sessionId: 'session-1',
};

describe('conflicts lifecycle', () => {
  let postgres: ReturnType<typeof createFakePostgres>['postgres'];

  beforeEach(() => {
    ({ postgres } = createFakePostgres());
  });

  it('creates a conflict in detected state', async () => {
    const conflict = await createConflict(TENANT_CONTEXT, postgres, {
      conflictType: 'contradicting_decision',
      sourceAType: 'decision',
      sourceAId: 'decision-a',
      sourceBType: 'decision',
      sourceBId: 'decision-b',
      severity: 'high',
    });
    expect(conflict.resolutionState).toBe('detected');
  });

  it('acknowledgeConflict transitions detected -> acknowledged', async () => {
    const conflict = await createConflict(TENANT_CONTEXT, postgres, {
      conflictType: 'contradicting_decision',
      sourceAType: 'decision',
      sourceAId: 'decision-a',
      sourceBType: 'decision',
      sourceBId: 'decision-b',
      severity: 'medium',
    });
    const acknowledged = await acknowledgeConflict(TENANT_CONTEXT, postgres, conflict.id);
    expect(acknowledged.resolutionState).toBe('acknowledged');
  });

  it('resolveConflict can resolve directly from detected', async () => {
    const conflict = await createConflict(TENANT_CONTEXT, postgres, {
      conflictType: 'contradicting_decision',
      sourceAType: 'decision',
      sourceAId: 'decision-a',
      sourceBType: 'decision',
      sourceBId: 'decision-b',
      severity: 'low',
    });
    const resolved = await resolveConflict(TENANT_CONTEXT, postgres, {
      conflictId: conflict.id,
      resolvedBy: 'user-1',
      resolutionNote: 'replaces: decision-b supersedes decision-a',
    });
    expect(resolved.resolutionState).toBe('resolved');
    expect(resolved.resolvedBy).toBe('user-1');
    expect(resolved.resolutionNote).toBe('replaces: decision-b supersedes decision-a');
  });

  it('rejects resolving an already-resolved conflict', async () => {
    const conflict = await createConflict(TENANT_CONTEXT, postgres, {
      conflictType: 'contradicting_decision',
      sourceAType: 'decision',
      sourceAId: 'decision-a',
      sourceBType: 'decision',
      sourceBId: 'decision-b',
      severity: 'low',
    });
    await resolveConflict(TENANT_CONTEXT, postgres, {
      conflictId: conflict.id,
      resolvedBy: 'user-1',
      resolutionNote: 'done',
    });

    await expect(
      resolveConflict(TENANT_CONTEXT, postgres, {
        conflictId: conflict.id,
        resolvedBy: 'user-1',
        resolutionNote: 'again',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError for an unknown conflict id', async () => {
    await expect(acknowledgeConflict(TENANT_CONTEXT, postgres, 'no-such-id')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('listUnresolvedConflicts excludes resolved conflicts', async () => {
    const a = await createConflict(TENANT_CONTEXT, postgres, {
      conflictType: 'contradicting_decision',
      sourceAType: 'decision',
      sourceAId: 'decision-a',
      sourceBType: 'decision',
      sourceBId: 'decision-b',
      severity: 'low',
    });
    const b = await createConflict(TENANT_CONTEXT, postgres, {
      conflictType: 'contradicting_action',
      sourceAType: 'action',
      sourceAId: 'action-a',
      sourceBType: 'action',
      sourceBId: 'action-b',
      severity: 'high',
    });
    await resolveConflict(TENANT_CONTEXT, postgres, { conflictId: b.id, resolvedBy: 'user-1', resolutionNote: 'fixed' });

    const unresolved = await listUnresolvedConflicts(TENANT_CONTEXT, postgres);
    expect(unresolved.map((row) => row.id)).toEqual([a.id]);
  });
});
