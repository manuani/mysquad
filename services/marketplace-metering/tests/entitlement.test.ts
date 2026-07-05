import { describe, expect, it, vi } from 'vitest';
import { checkEntitlement, PLAN_LIMITS } from '../src/entitlement.js';
import type { TenantContext } from '@voai/types';
import type { TenantScopedClient } from '@voai/db';

function makeTc(tenantId = 'tenant-1'): TenantContext {
  return { tenantId, userId: 'user-1', userType: 'founder', sessionId: undefined };
}

function makeClient(planOverride: string, countOverride: string): TenantScopedClient {
  return {
    query: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('identity_tenants')) {
        return Promise.resolve({ rows: [{ plan: planOverride }] });
      }
      return Promise.resolve({ rows: [{ count: countOverride }] });
    }),
  } as unknown as TenantScopedClient;
}

describe('checkEntitlement', () => {
  it('allows roster_calls_per_month when under starter limit', async () => {
    const client = makeClient('starter', '50');
    const status = await checkEntitlement(makeTc(), client, 'roster_calls_per_month');
    expect(status.allowed).toBe(true);
    expect(status.limit).toBe(PLAN_LIMITS.starter.roster_calls_per_month);
    expect(status.current).toBe(50);
    expect(status.plan).toBe('starter');
  });

  it('blocks roster_calls_per_month when at starter limit', async () => {
    const client = makeClient('starter', '100');
    const status = await checkEntitlement(makeTc(), client, 'roster_calls_per_month');
    expect(status.allowed).toBe(false);
    expect(status.current).toBe(100);
  });

  it('allows enterprise plan with Infinity limit (no usage query needed)', async () => {
    const client = makeClient('enterprise', '0');
    const status = await checkEntitlement(makeTc(), client, 'roster_calls_per_month');
    expect(status.allowed).toBe(true);
    expect(status.limit).toBe(Infinity);
    // Should not query usage for enterprise
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('allows growth plan at 999 calls (under limit of 1000)', async () => {
    const client = makeClient('growth', '999');
    const status = await checkEntitlement(makeTc(), client, 'roster_calls_per_month');
    expect(status.allowed).toBe(true);
    expect(status.limit).toBe(PLAN_LIMITS.growth.roster_calls_per_month);
  });

  it('blocks expert_sessions when at starter limit of 2', async () => {
    const client = makeClient('starter', '2');
    const status = await checkEntitlement(makeTc(), client, 'expert_sessions_per_month');
    expect(status.allowed).toBe(false);
    expect(status.limit).toBe(2);
  });

  it('returns correct dimension in status', async () => {
    const client = makeClient('starter', '1');
    const status = await checkEntitlement(makeTc(), client, 'seats');
    expect(status.dimension).toBe('seats');
  });
});
