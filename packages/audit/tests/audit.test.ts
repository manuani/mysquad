import { describe, expect, it, vi } from 'vitest';
import { recordAuditEvent } from '../src/audit.js';

function makePostgres(queryFn = vi.fn().mockResolvedValue({ rows: [] })) {
  return {
    withTenant: vi.fn((_id: string, fn: (c: unknown) => Promise<unknown>) =>
      fn({ query: queryFn }),
    ),
    adminQuery: vi.fn().mockResolvedValue([]),
  };
}

describe('recordAuditEvent', () => {
  it('inserts a row with the correct action and outcome', async () => {
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const postgres = makePostgres(queryFn);

    await recordAuditEvent(postgres as never, {
      tenantId: 'tenant-1',
      actorId: 'user-1',
      actorType: 'founder',
      action: 'POST /v1/brain/items',
      outcome: 'success',
    });

    expect(postgres.withTenant).toHaveBeenCalledWith('tenant-1', expect.any(Function));
    expect(queryFn).toHaveBeenCalledOnce();
    const [sql, params] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO audit_log');
    expect(params[3]).toBe('POST /v1/brain/items');
    expect(params[6]).toBe('success');
  });

  it('falls back to SYSTEM_TENANT scope when tenantId is absent', async () => {
    const postgres = makePostgres();

    await recordAuditEvent(postgres as never, {
      action: 'webhook.stripe.subscription.created',
      outcome: 'success',
      actorType: 'webhook',
    });

    expect(postgres.withTenant).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000000',
      expect.any(Function),
    );
  });

  it('swallows DB errors without throwing', async () => {
    const postgres = makePostgres(vi.fn().mockRejectedValue(new Error('db down')));

    // Should not throw
    await expect(
      recordAuditEvent(postgres as never, { action: 'test', outcome: 'failure' }),
    ).resolves.toBeUndefined();
  });

  it('uses TenantContext when event fields are absent', async () => {
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const postgres = makePostgres(queryFn);
    const tc = { tenantId: 'tenant-ctx', userId: 'user-ctx', userType: 'admin', sessionId: 's1' };

    await recordAuditEvent(
      postgres as never,
      { action: 'DELETE /v1/identity/me', outcome: 'success' },
      tc as never,
    );

    expect(postgres.withTenant).toHaveBeenCalledWith('tenant-ctx', expect.any(Function));
    const params = queryFn.mock.calls[0]![1] as unknown[];
    expect(params[0]).toBe('tenant-ctx');
    expect(params[1]).toBe('user-ctx');
  });
});
