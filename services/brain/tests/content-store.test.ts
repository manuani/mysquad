import { beforeEach, describe, expect, it } from 'vitest';
import type { PostgresClient, TenantScopedClient } from '@voai/db';
import type { TenantContext } from '@voai/auth-context';
import { NotFoundError, ValidationError } from '@voai/errors';
import {
  createBrainContentItem,
  deleteBrainContentItem,
  getBrainContentHistory,
  getBrainContentItem,
  listBrainContentByDomain,
  searchBrainContent,
  updateBrainContentItem,
} from '../src/content-store.js';

/**
 * In-memory fake standing in for Postgres, scoped to exactly the queries
 * content-store.ts issues. This exercises the `withTenant`-only access
 * pattern (ADR 007 / packages/db README) without a live database, mirroring
 * services/identity-and-tenancy/tests/dev-auth-provider.test.ts.
 */
function createFakePostgres() {
  interface ContentRow {
    id: string;
    tenant_id: string;
    domain: string;
    language: string;
    content: string;
    content_en: string | null;
    source: string;
    deleted_at: string | null;
    ingested_at: string;
    updated_at: string;
  }
  interface AuditRow {
    id: string;
    tenant_id: string;
    item_id: string;
    changed_at: string;
    changed_by: string | null;
    change_type: string;
    source: string;
    before_value: unknown;
    after_value: unknown;
  }

  const content: ContentRow[] = [];
  const audit: AuditRow[] = [];
  let counter = 0;
  const nextId = () => `id-${++counter}`;

  const client: TenantScopedClient = {
    async query<T = unknown>(text: string, params: unknown[] = []) {
      const sql = text.trim().toLowerCase().replace(/\s+/g, ' ');

      if (sql.startsWith('insert into brain_content_canonical')) {
        const row: ContentRow = {
          id: nextId(),
          tenant_id: params[0] as string,
          domain: params[1] as string,
          language: params[2] as string,
          content: params[3] as string,
          content_en: (params[4] as string | null) ?? null,
          source: params[5] as string,
          deleted_at: null,
          ingested_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        content.push(row);
        return { rows: [row] as T[] };
      }

      if (sql.startsWith('insert into brain_content_audit')) {
        const changeType: 'create' | 'update' | 'delete' = sql.includes("'create'")
          ? 'create'
          : sql.includes("'update'")
            ? 'update'
            : 'delete';
        // Parameter positions mirror the literal SQL in content-store.ts for
        // each change type: create has before_value as a literal `null` (not
        // a placeholder) and after_value at $5; update has before at $5,
        // after at $6; delete has before at $5 and after as a literal `null`.
        let beforeValue: unknown = null;
        let afterValue: unknown = null;
        if (changeType === 'create') {
          afterValue = params[4] ? JSON.parse(params[4] as string) : null;
        } else if (changeType === 'update') {
          beforeValue = params[4] ? JSON.parse(params[4] as string) : null;
          afterValue = params[5] ? JSON.parse(params[5] as string) : null;
        } else {
          beforeValue = params[4] ? JSON.parse(params[4] as string) : null;
        }
        const row: AuditRow = {
          id: nextId(),
          tenant_id: params[0] as string,
          item_id: params[1] as string,
          changed_by: params[2] as string | null,
          change_type: changeType,
          source: params[3] as string,
          before_value: beforeValue,
          after_value: afterValue,
          changed_at: new Date().toISOString(),
        };
        audit.push(row);
        return { rows: [] as T[] };
      }

      if (sql.includes('from brain_content_canonical where domain = $1 and deleted_at is null')) {
        const rows = content
          .filter((c) => c.domain === params[0] && c.deleted_at === null)
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        return { rows: rows as T[] };
      }

      if (
        sql.includes('from brain_content_canonical where id = $1 and deleted_at is null') &&
        sql.startsWith('select')
      ) {
        const row = content.find((c) => c.id === params[0] && c.deleted_at === null);
        return { rows: (row ? [row] : []) as T[] };
      }

      if (sql.startsWith('update brain_content_canonical set content')) {
        const row = content.find((c) => c.id === params[3] && c.deleted_at === null);
        if (!row) return { rows: [] as T[] };
        row.content = params[0] as string;
        row.content_en = (params[1] as string | null) ?? null;
        row.source = params[2] as string;
        row.updated_at = new Date().toISOString();
        return { rows: [row] as T[] };
      }

      if (sql.startsWith('update brain_content_canonical set deleted_at')) {
        const row = content.find((c) => c.id === params[0]);
        if (row) {
          row.deleted_at = new Date().toISOString();
          row.updated_at = row.deleted_at;
        }
        return { rows: [] as T[] };
      }

      if (sql.includes('from brain_content_audit') && sql.includes('where item_id = $1')) {
        const rows = audit.filter((a) => a.item_id === params[0]).sort((a, b) => a.changed_at.localeCompare(b.changed_at));
        return { rows: rows as T[] };
      }

      if (sql.includes('content ilike $1 or content_en ilike $1')) {
        const pattern = (params[0] as string).replace(/%/g, '').toLowerCase();
        const rows = content
          .filter(
            (c) =>
              c.deleted_at === null &&
              (c.content.toLowerCase().includes(pattern) || (c.content_en ?? '').toLowerCase().includes(pattern)),
          )
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        return { rows: rows as T[] };
      }

      throw new Error(`fake postgres: unhandled query: ${text}`);
    },
  };

  const postgres: PostgresClient = {
    async withTenant<T>(_tenantId: string, fn: (c: TenantScopedClient) => Promise<T>): Promise<T> {
      return fn(client);
    },
  };

  return { postgres, content, audit };
}

const TENANT: TenantContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  userType: 'founder',
  sessionId: 'session-1',
};

describe('brain content store', () => {
  let postgres: PostgresClient;

  beforeEach(() => {
    ({ postgres } = createFakePostgres());
  });

  it('creates a brain content item and an audit entry', async () => {
    const item = await createBrainContentItem(TENANT, postgres, {
      domain: 'goals',
      language: 'en',
      content: 'Reach $1M ARR by Q4',
      source: 'founder_edit',
    });

    expect(item.domain).toBe('goals');
    expect(item.content).toBe('Reach $1M ARR by Q4');
    expect(item.deletedAt).toBeNull();

    const history = await getBrainContentHistory(TENANT, postgres, item.id);
    expect(history).toHaveLength(1);
    expect(history[0].changeType).toBe('create');
    expect(history[0].beforeValue).toBeNull();
  });

  it('rejects empty content with ValidationError', async () => {
    await expect(
      createBrainContentItem(TENANT, postgres, {
        domain: 'risks',
        language: 'en',
        content: '   ',
        source: 'founder_edit',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('lists items scoped to one domain, newest first', async () => {
    await createBrainContentItem(TENANT, postgres, {
      domain: 'risks',
      language: 'en',
      content: 'Key supplier concentration risk',
      source: 'founder_edit',
    });
    await createBrainContentItem(TENANT, postgres, {
      domain: 'goals',
      language: 'en',
      content: 'Hire a VP Sales',
      source: 'founder_edit',
    });

    const risks = await listBrainContentByDomain(TENANT, postgres, 'risks');
    expect(risks).toHaveLength(1);
    expect(risks[0].domain).toBe('risks');
  });

  it('gets a single item by id', async () => {
    const created = await createBrainContentItem(TENANT, postgres, {
      domain: 'decisions',
      language: 'en',
      content: 'Chose AWS over GCP',
      source: 'agent_extraction',
    });

    const fetched = await getBrainContentItem(TENANT, postgres, created.id);
    expect(fetched?.id).toBe(created.id);
  });

  it('returns null for a missing item', async () => {
    const fetched = await getBrainContentItem(TENANT, postgres, 'does-not-exist');
    expect(fetched).toBeNull();
  });

  it('updates an item and records before/after audit values', async () => {
    const created = await createBrainContentItem(TENANT, postgres, {
      domain: 'financial_state',
      language: 'en',
      content: 'Runway: 14 months',
      source: 'integration_import',
    });

    const updated = await updateBrainContentItem(TENANT, postgres, created.id, {
      content: 'Runway: 11 months',
      source: 'founder_edit',
    });

    expect(updated.content).toBe('Runway: 11 months');

    const history = await getBrainContentHistory(TENANT, postgres, created.id);
    expect(history).toHaveLength(2);
    expect(history[1].changeType).toBe('update');
    expect((history[1].beforeValue as { content: string }).content).toBe('Runway: 14 months');
    expect((history[1].afterValue as { content: string }).content).toBe('Runway: 11 months');
  });

  it('updating a missing item throws NotFoundError', async () => {
    await expect(
      updateBrainContentItem(TENANT, postgres, 'missing-id', { content: 'x', source: 'founder_edit' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('soft-deletes an item so it no longer appears in list/get/search', async () => {
    const created = await createBrainContentItem(TENANT, postgres, {
      domain: 'company_profile',
      language: 'en',
      content: 'Founded in 2023',
      source: 'founder_edit',
    });

    await deleteBrainContentItem(TENANT, postgres, created.id, 'founder_edit');

    const fetched = await getBrainContentItem(TENANT, postgres, created.id);
    expect(fetched).toBeNull();

    const list = await listBrainContentByDomain(TENANT, postgres, 'company_profile');
    expect(list).toHaveLength(0);

    const history = await getBrainContentHistory(TENANT, postgres, created.id);
    expect(history.some((h) => h.changeType === 'delete')).toBe(true);
  });

  it('deleting a missing item throws NotFoundError', async () => {
    await expect(deleteBrainContentItem(TENANT, postgres, 'missing-id', 'founder_edit')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('searches content via ILIKE across domains', async () => {
    await createBrainContentItem(TENANT, postgres, {
      domain: 'market_and_customers',
      language: 'en',
      content: 'Largest customer is Acme Corp',
      source: 'founder_edit',
    });
    await createBrainContentItem(TENANT, postgres, {
      domain: 'competitive_landscape',
      language: 'en',
      content: 'Main competitor is Globex',
      source: 'founder_edit',
    });

    const results = await searchBrainContent(TENANT, postgres, 'Acme');
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('Acme');
  });

  it('search rejects an empty query', async () => {
    await expect(searchBrainContent(TENANT, postgres, '')).rejects.toBeInstanceOf(ValidationError);
  });
});
