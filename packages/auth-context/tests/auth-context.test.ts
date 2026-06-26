import { describe, expect, it } from 'vitest';
import {
  type AuthContext,
  currentAuthContext,
  requireAuthContext,
  withAuthContext,
} from '../src/index.js';

const sampleCtx: AuthContext = {
  tenantId: 'tenant_123',
  userId: 'user_456',
  userType: 'founder',
  sessionId: 'session_789',
};

describe('auth-context', () => {
  it('makes the context available inside withAuthContext', () => {
    const result = withAuthContext(sampleCtx, () => currentAuthContext());
    expect(result).toEqual(sampleCtx);
  });

  it('returns undefined outside any withAuthContext block', () => {
    expect(currentAuthContext()).toBeUndefined();
  });

  it('requireAuthContext throws when no context is set', () => {
    expect(() => requireAuthContext()).toThrow(/No auth context/);
  });

  it('requireAuthContext returns the context when set', () => {
    const result = withAuthContext(sampleCtx, () => requireAuthContext());
    expect(result.tenantId).toBe('tenant_123');
  });

  it('propagates context across async boundaries', async () => {
    const result = await withAuthContext(sampleCtx, async () => {
      await Promise.resolve();
      return currentAuthContext();
    });
    expect(result?.tenantId).toBe('tenant_123');
  });
});
