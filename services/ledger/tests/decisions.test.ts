import { beforeEach, describe, expect, it } from 'vitest';
import type { TenantContext } from '@voai/auth-context';
import { NotFoundError, ValidationError } from '@voai/errors';
import {
  abandonDecision,
  confirmDecision,
  createDecision,
  recordDecisionOutcome,
  supersedeDecision,
} from '../src/decisions.js';
import { createFakePostgres } from './fake-postgres.js';

const TENANT_CONTEXT: TenantContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  userType: 'founder',
  sessionId: 'session-1',
};

describe('decisions lifecycle', () => {
  let postgres: ReturnType<typeof createFakePostgres>['postgres'];

  beforeEach(() => {
    ({ postgres } = createFakePostgres());
  });

  it('creates a decision in draft state by default', async () => {
    const decision = await createDecision(TENANT_CONTEXT, postgres, {
      decisionType: 'pricing',
      summary: 'Raise prices 10%',
      stakesLevel: 'high',
    });
    expect(decision.state).toBe('draft');
    expect(decision.confirmedAt).toBeNull();
  });

  it('confirmDecision transitions draft -> active and stamps confirmedAt', async () => {
    const decision = await createDecision(TENANT_CONTEXT, postgres, {
      decisionType: 'pricing',
      summary: 'Raise prices 10%',
      stakesLevel: 'high',
    });
    const confirmed = await confirmDecision(TENANT_CONTEXT, postgres, decision.id, 'user-1');
    expect(confirmed.state).toBe('active');
    expect(confirmed.confirmedBy).toBe('user-1');
    expect(confirmed.confirmedAt).not.toBeNull();
  });

  it('rejects confirming an already-abandoned decision', async () => {
    const decision = await createDecision(TENANT_CONTEXT, postgres, {
      decisionType: 'pricing',
      summary: 'Raise prices 10%',
      stakesLevel: 'low',
    });
    await abandonDecision(TENANT_CONTEXT, postgres, decision.id, 'no longer relevant');

    await expect(
      confirmDecision(TENANT_CONTEXT, postgres, decision.id, 'user-1'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when confirming an unknown decision', async () => {
    await expect(
      confirmDecision(TENANT_CONTEXT, postgres, 'no-such-id', 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('recordDecisionOutcome stores free-text outcome and timestamp', async () => {
    const decision = await createDecision(TENANT_CONTEXT, postgres, {
      decisionType: 'pricing',
      summary: 'Raise prices 10%',
      stakesLevel: 'medium',
      state: 'active',
    });
    const withOutcome = await recordDecisionOutcome(TENANT_CONTEXT, postgres, {
      decisionId: decision.id,
      outcome: 'It worked',
    });
    expect(withOutcome.outcome).toBe('It worked');
    expect(withOutcome.outcomeLoggedAt).not.toBeNull();
  });

  describe('supersedeDecision (four-button conflict resolution)', () => {
    it('replaces marks the prior decision superseded and links superseded_by', async () => {
      const prior = await createDecision(TENANT_CONTEXT, postgres, {
        decisionType: 'pricing',
        summary: 'Old plan',
        stakesLevel: 'medium',
        state: 'active',
      });
      const next = await createDecision(TENANT_CONTEXT, postgres, {
        decisionType: 'pricing',
        summary: 'New plan',
        stakesLevel: 'medium',
        state: 'active',
      });

      const result = await supersedeDecision(TENANT_CONTEXT, postgres, {
        priorDecisionId: prior.id,
        newDecisionId: next.id,
        mode: 'replaces',
        reason: 'market changed',
      });

      expect(result.state).toBe('superseded');
      expect(result.supersededBy).toBe(next.id);
      expect(result.supersessionReason).toBe('market changed');
    });

    it('abandons marks the prior decision abandoned with no new decision', async () => {
      const prior = await createDecision(TENANT_CONTEXT, postgres, {
        decisionType: 'pricing',
        summary: 'Old plan',
        stakesLevel: 'low',
        state: 'active',
      });

      const result = await supersedeDecision(TENANT_CONTEXT, postgres, {
        priorDecisionId: prior.id,
        mode: 'abandons',
        reason: 'no longer needed',
      });

      expect(result.state).toBe('abandoned');
      expect(result.supersededBy).toBeNull();
    });

    it('abandons rejects a newDecisionId being supplied', async () => {
      const prior = await createDecision(TENANT_CONTEXT, postgres, {
        decisionType: 'pricing',
        summary: 'Old plan',
        stakesLevel: 'low',
        state: 'active',
      });
      const next = await createDecision(TENANT_CONTEXT, postgres, {
        decisionType: 'pricing',
        summary: 'New plan',
        stakesLevel: 'low',
      });

      await expect(
        supersedeDecision(TENANT_CONTEXT, postgres, {
          priorDecisionId: prior.id,
          newDecisionId: next.id,
          mode: 'abandons',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('refines requires a newDecisionId and leaves the prior decision active', async () => {
      const prior = await createDecision(TENANT_CONTEXT, postgres, {
        decisionType: 'pricing',
        summary: 'Parent plan',
        stakesLevel: 'medium',
        state: 'active',
      });

      await expect(
        supersedeDecision(TENANT_CONTEXT, postgres, { priorDecisionId: prior.id, mode: 'refines' }),
      ).rejects.toBeInstanceOf(ValidationError);

      const child = await createDecision(TENANT_CONTEXT, postgres, {
        decisionType: 'pricing',
        summary: 'Child plan',
        stakesLevel: 'medium',
        state: 'active',
      });
      const result = await supersedeDecision(TENANT_CONTEXT, postgres, {
        priorDecisionId: prior.id,
        newDecisionId: child.id,
        mode: 'refines',
      });
      expect(result.state).toBe('active');
      expect(result.supersededBy).toBeNull();
    });

    it('parallel leaves both decisions standing independently', async () => {
      const a = await createDecision(TENANT_CONTEXT, postgres, {
        decisionType: 'pricing',
        summary: 'Plan A',
        stakesLevel: 'low',
        state: 'active',
      });
      const b = await createDecision(TENANT_CONTEXT, postgres, {
        decisionType: 'pricing',
        summary: 'Plan B',
        stakesLevel: 'low',
        state: 'active',
      });

      const result = await supersedeDecision(TENANT_CONTEXT, postgres, {
        priorDecisionId: a.id,
        newDecisionId: b.id,
        mode: 'parallel',
      });
      expect(result.state).toBe('active');
    });

    it('replaces a superseded decision again is rejected (terminal state)', async () => {
      const prior = await createDecision(TENANT_CONTEXT, postgres, {
        decisionType: 'pricing',
        summary: 'Old plan',
        stakesLevel: 'medium',
        state: 'active',
      });
      const next = await createDecision(TENANT_CONTEXT, postgres, {
        decisionType: 'pricing',
        summary: 'New plan',
        stakesLevel: 'medium',
        state: 'active',
      });
      await supersedeDecision(TENANT_CONTEXT, postgres, {
        priorDecisionId: prior.id,
        newDecisionId: next.id,
        mode: 'replaces',
      });

      await expect(
        supersedeDecision(TENANT_CONTEXT, postgres, {
          priorDecisionId: prior.id,
          newDecisionId: next.id,
          mode: 'replaces',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });
});
