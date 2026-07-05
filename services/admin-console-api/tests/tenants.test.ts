import { describe, expect, it } from 'vitest';
import { listAllTenants, provisionTenant } from '../src/tenants.js';

const TENANT_ROW = {
  tenant_id: 'tenant-uuid',
  name: 'Acme Corp',
  email: 'acme@example.com',
  plan: 'growth',
  status: 'active',
  created_at: new Date('2024-01-01'),
  total_cost_micro_this_month: 15000,
  total_roster_calls_this_month: 42,
};

function makePostgres(rows: Record<string, unknown>[], countStr = '1') {
  return {
    async adminQuery(_sql: string, _params: unknown[]) {
      // First call → data rows, second call → count
      if (_sql.includes('COUNT')) return [{ count: countStr }] as unknown[];
      return rows as unknown[];
    },
    async withTenant(_tid: string, _fn: unknown) {
      return null;
    },
  };
}

describe('listAllTenants', () => {
  it('returns tenants with usage fields', async () => {
    const postgres = makePostgres([TENANT_ROW]);
    const result = await listAllTenants(postgres as never);
    expect(result.tenants).toHaveLength(1);
    expect(result.tenants[0]!.tenantId).toBe('tenant-uuid');
    expect(result.tenants[0]!.totalCostMicroThisMonth).toBe(15000);
    expect(result.tenants[0]!.totalRosterCallsThisMonth).toBe(42);
  });

  it('returns total count', async () => {
    const postgres = makePostgres([TENANT_ROW], '7');
    const result = await listAllTenants(postgres as never);
    expect(result.total).toBe(7);
  });

  it('returns empty array when no tenants exist', async () => {
    const postgres = makePostgres([], '0');
    const result = await listAllTenants(postgres as never);
    expect(result.tenants).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

describe('provisionTenant', () => {
  it('returns the new tenant id and plan', async () => {
    const postgres = {
      async adminQuery(_sql: string, _params: unknown[]) {
        return [{ id: 'new-tenant-id', email: 'newco@example.com', plan: 'starter' }] as unknown[];
      },
      async withTenant(_tid: string, _fn: unknown) {
        return null;
      },
    };
    const result = await provisionTenant(postgres as never, {
      name: 'NewCo',
      email: 'newco@example.com',
    });
    expect(result.tenantId).toBe('new-tenant-id');
    expect(result.plan).toBe('starter');
  });
});
