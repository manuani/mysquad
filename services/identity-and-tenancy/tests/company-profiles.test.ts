/**
 * A tenant used to be a company. A founder with two ventures had to choose
 * between mixing both into one brain — where advisors reason about the wrong
 * company's runway — or keeping two logins.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createProfile,
  getDefaultProfile,
  listProfiles,
  updateProfile,
  assertProfileBelongsToTenant,
} from '../src/company-profiles.js';
import type { TenantContext } from '@voai/auth-context';
import type { PostgresClient } from '@voai/db';

const TC: TenantContext = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  userType: 'founder',
  sessionId: 'session-1',
};

const ROW = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  name: 'iTrendFast',
  description: null,
  industry: 'Retail SaaS',
  is_default: true,
  created_at: new Date('2026-08-19T10:00:00Z'),
};

/** Fake Postgres driven by SQL matching, as the repo's other data tests are. */
function makePostgres(opts: { existingCount?: number; rows?: Array<Record<string, unknown>> } = {}) {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes('COUNT(*)')) return { rows: [{ n: String(opts.existingCount ?? 0) }] };
      if (sql.trimStart().toUpperCase().startsWith('UPDATE') && !sql.includes('RETURNING')) {
        return { rows: [] };
      }
      return { rows: opts.rows ?? [ROW] };
    }),
  };
  const postgres = {
    withTenant: async (_t: string, fn: never) => (fn as never as (c: unknown) => unknown)(client),
  } as unknown as PostgresClient;
  return { postgres, queries };
}

describe('createProfile', () => {
  it('makes the first company the default whatever the caller asked', async () => {
    // An account with companies but no default opens onto nothing.
    const { postgres, queries } = makePostgres({ existingCount: 0 });
    await createProfile(TC, postgres, { name: 'iTrendFast', isDefault: false });

    const insert = queries.find((q) => q.sql.includes('INSERT INTO company_profiles'));
    expect(insert?.params).toContain(true);
  });

  it('does not make a later company default unless asked', async () => {
    const { postgres, queries } = makePostgres({ existingCount: 1, rows: [{ ...ROW, is_default: false }] });
    await createProfile(TC, postgres, { name: 'Shree Steel' });

    const insert = queries.find((q) => q.sql.includes('INSERT INTO company_profiles'));
    expect(insert?.params).toContain(false);
  });

  it('demotes the incumbent before claiming default', async () => {
    // A partial unique index permits one default per tenant, so this would
    // fail rather than switch if the incumbent were left in place.
    const { postgres, queries } = makePostgres({ existingCount: 1 });
    await createProfile(TC, postgres, { name: 'Shree Steel', isDefault: true });

    const demote = queries.findIndex((q) => q.sql.includes('SET is_default = false'));
    const insert = queries.findIndex((q) => q.sql.includes('INSERT INTO company_profiles'));
    expect(demote).toBeGreaterThanOrEqual(0);
    expect(demote).toBeLessThan(insert);
  });

  it('requires a name', async () => {
    const { postgres } = makePostgres();
    await expect(createProfile(TC, postgres, { name: '   ' })).rejects.toThrow(/name is required/);
  });

  it('rejects a name too long to display', async () => {
    const { postgres } = makePostgres();
    await expect(createProfile(TC, postgres, { name: 'x'.repeat(200) })).rejects.toThrow(/120/);
  });

  it('records who created it and under which tenant', async () => {
    const { postgres, queries } = makePostgres();
    await createProfile(TC, postgres, { name: 'iTrendFast' });

    const insert = queries.find((q) => q.sql.includes('INSERT INTO company_profiles'));
    expect(insert?.params).toContain(TC.tenantId);
    expect(insert?.params).toContain(TC.userId);
  });
});

describe('updateProfile', () => {
  it('demotes the incumbent when promoting another, excluding itself', async () => {
    const { postgres, queries } = makePostgres();
    await updateProfile(TC, postgres, ROW.id, { isDefault: true });

    const demote = queries.find((q) => q.sql.includes('SET is_default = false'));
    expect(demote?.sql).toContain('id <> $1');
    expect(demote?.params).toContain(ROW.id);
  });

  it('rejects clearing the name', async () => {
    const { postgres } = makePostgres();
    await expect(updateProfile(TC, postgres, ROW.id, { name: '  ' })).rejects.toThrow(/cannot be empty/);
  });

  it('reports a profile that does not exist', async () => {
    const { postgres } = makePostgres({ rows: [] });
    await expect(updateProfile(TC, postgres, ROW.id, { name: 'x' })).rejects.toThrow(/not found/);
  });
});

describe('getDefaultProfile', () => {
  it('falls back to any company when no default is set', async () => {
    // A founder who deleted their default still has companies; returning
    // nothing would strand them on an empty picker.
    const { postgres, queries } = makePostgres({ rows: [{ ...ROW, is_default: false }] });
    const profile = await getDefaultProfile(TC, postgres);

    expect(profile?.id).toBe(ROW.id);
    expect(queries[0]!.sql).toContain('ORDER BY is_default DESC');
  });

  it('returns null for an account with no companies', async () => {
    const { postgres } = makePostgres({ rows: [] });
    expect(await getDefaultProfile(TC, postgres)).toBeNull();
  });
});

describe('assertProfileBelongsToTenant', () => {
  it('rejects an id the tenant does not own', async () => {
    // RLS stops another tenant's rows being read, but an unchecked id would be
    // written onto new records, attaching this tenant's data to a profile they
    // do not own.
    const { postgres } = makePostgres({ rows: [] });
    await expect(assertProfileBelongsToTenant(TC, postgres, 'someone-elses')).rejects.toThrow(/not found/);
  });

  it('accepts one they do', async () => {
    const { postgres } = makePostgres();
    await expect(assertProfileBelongsToTenant(TC, postgres, ROW.id)).resolves.toBeUndefined();
  });
});

describe('listProfiles', () => {
  it('puts the default first', async () => {
    const { postgres, queries } = makePostgres();
    await listProfiles(TC, postgres);
    expect(queries[0]!.sql).toContain('ORDER BY is_default DESC, name ASC');
  });

  it('scopes the read to the caller tenant', async () => {
    const withTenant = vi.fn(async (_t: string, fn: never) =>
      (fn as never as (c: unknown) => unknown)({ query: async () => ({ rows: [] }) }),
    );
    await listProfiles(TC, { withTenant } as unknown as PostgresClient);
    expect(withTenant).toHaveBeenCalledWith(TC.tenantId, expect.any(Function));
  });
});
