import { describe, expect, it } from 'vitest';
import type { TenantContext } from '@voai/auth-context';
import type { PostgresClient, TenantScopedClient } from '@voai/db';
import { fetchBrainContextForMessage } from '../src/brain-context.js';

const TENANT_CONTEXT: TenantContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  userType: 'founder',
  sessionId: 'session-1',
};

/**
 * Fakes the two real-table queries @voai/brain's searchBrainContent and
 * listBrainContentByDomain issue. Keyed loosely on SQL shape, mirroring
 * the pattern in services/identity-and-tenancy and services/ledger's own
 * fake-postgres test fixtures.
 */
function makeFakePostgres(items: { domain: string; content: string; updatedAt: string }[]): PostgresClient {
  const rows = items.map(toRow);
  const client: TenantScopedClient = {
    async query<T = unknown>(text: string, params: unknown[] = []) {
      const sql = text.trim().toLowerCase();
      if (sql.includes('content ilike')) {
        const pattern = String(params[0]).replace(/%/g, '').toLowerCase();
        const matches = rows.filter((r) => r.content.toLowerCase().includes(pattern));
        return { rows: matches as T[] };
      }
      if (sql.includes('where domain =')) {
        const domain = params[0];
        const matches = rows.filter((r) => r.domain === domain);
        return { rows: matches as T[] };
      }
      return { rows: [] as T[] };
    },
  };
  return { withTenant: async (_tenantId, fn) => fn(client) };
}

function toRow(item: { domain: string; content: string; updatedAt: string }, index: number) {
  return {
    id: `id-${index}`,
    tenant_id: 'tenant-1',
    domain: item.domain,
    language: 'en',
    content: item.content,
    content_en: null,
    source: 'founder_edit',
    deleted_at: null,
    ingested_at: item.updatedAt,
    updated_at: item.updatedAt,
  };
}

describe('fetchBrainContextForMessage', () => {
  it('returns search matches formatted with domain when the message keyword matches', async () => {
    const postgres = makeFakePostgres([
      { domain: 'financial_state', content: 'Burn rate is $80k/month', updatedAt: '2026-01-01T00:00:00Z' },
      { domain: 'company_profile', content: 'B2B SaaS company', updatedAt: '2026-01-02T00:00:00Z' },
    ]);

    const result = await fetchBrainContextForMessage(TENANT_CONTEXT, postgres, 'What is our burn rate?');

    expect(result).toEqual(['[financial_state] Burn rate is $80k/month']);
  });

  it('falls back to the most recently updated items across domains when search finds nothing', async () => {
    const postgres = makeFakePostgres([
      { domain: 'company_profile', content: 'Older fact', updatedAt: '2026-01-01T00:00:00Z' },
      { domain: 'goals', content: 'Newer fact', updatedAt: '2026-01-05T00:00:00Z' },
    ]);

    const result = await fetchBrainContextForMessage(TENANT_CONTEXT, postgres, 'unrelated query xyz');

    expect(result).toEqual(['[goals] Newer fact', '[company_profile] Older fact']);
  });

  it('returns an empty array when the tenant has no brain content at all', async () => {
    const postgres = makeFakePostgres([]);

    const result = await fetchBrainContextForMessage(TENANT_CONTEXT, postgres, 'anything');

    expect(result).toEqual([]);
  });

  it('caps results at 5 items', async () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      domain: 'goals',
      content: `fact ${i}`,
      updatedAt: new Date(2026, 0, i + 1).toISOString(),
    }));
    const postgres = makeFakePostgres(items);

    const result = await fetchBrainContextForMessage(TENANT_CONTEXT, postgres, 'no match here');

    expect(result).toHaveLength(5);
  });
});
