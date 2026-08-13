/**
 * Meeting briefs — the agenda a founder uploads so advisors arrive knowing the
 * subject, instead of opening with "what is this about?".
 */

import { describe, expect, it, vi } from 'vitest';
import { saveBrief, getBrief, deleteBrief, MAX_BRIEF_CHARS } from '../src/brief.js';
import type { TenantContext } from '@voai/auth-context';
import type { PostgresClient } from '@voai/db';

const TC: TenantContext = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  userType: 'founder',
  sessionId: 'session-1',
};

const SESSION = '33333333-3333-3333-3333-333333333333';

/** Fake Postgres driven by SQL matching, mirroring the repo's other route tests. */
function makePostgres(handlers: {
  sessionExists?: boolean;
  briefRow?: Record<string, unknown> | null;
  onQuery?: (sql: string, params?: unknown[]) => void;
}): PostgresClient {
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      handlers.onQuery?.(sql, params);
      if (sql.includes('FROM sessions')) {
        return { rows: handlers.sessionExists === false ? [] : [{ id: SESSION }] };
      }
      if (sql.includes('DELETE FROM meeting_briefs')) {
        return { rows: handlers.briefRow === null ? [] : [{ session_id: SESSION }] };
      }
      if (handlers.briefRow === null) return { rows: [] };
      return {
        rows: [
          {
            session_id: SESSION,
            title: 'Q3 launch',
            content: 'We are launching iTrendFast in October.',
            source_filename: 'agenda.md',
            created_at: new Date('2026-08-13T10:00:00Z'),
            updated_at: new Date('2026-08-13T10:00:00Z'),
            ...handlers.briefRow,
          },
        ],
      };
    }),
  };
  return { withTenant: async (_t, fn) => fn(client as never) } as unknown as PostgresClient;
}

describe('saveBrief', () => {
  it('stores the brief for the session', async () => {
    const brief = await saveBrief(TC, makePostgres({}), {
      sessionId: SESSION,
      content: 'We are launching iTrendFast in October.',
      title: 'Q3 launch',
      sourceFilename: 'agenda.md',
    });

    expect(brief.sessionId).toBe(SESSION);
    expect(brief.title).toBe('Q3 launch');
    expect(brief.content).toContain('iTrendFast');
  });

  it('replaces rather than accumulates on re-upload', async () => {
    // A session has one agenda; a founder fixing a typo must not leave two
    // versions for the advisors to reconcile.
    let sql = '';
    await saveBrief(TC, makePostgres({ onQuery: (q) => { if (q.includes('meeting_briefs')) sql = q; } }), {
      sessionId: SESSION,
      content: 'Updated agenda',
    });
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('DO UPDATE');
  });

  it('rejects an empty brief', async () => {
    await expect(
      saveBrief(TC, makePostgres({}), { sessionId: SESSION, content: '   ' }),
    ).rejects.toThrow(/content is required/);
  });

  it('rejects a brief too large to inject into every turn', async () => {
    await expect(
      saveBrief(TC, makePostgres({}), { sessionId: SESSION, content: 'x'.repeat(MAX_BRIEF_CHARS + 1) }),
    ).rejects.toThrow(/maximum/);
  });

  it('refuses a session that does not exist for this tenant', async () => {
    await expect(
      saveBrief(TC, makePostgres({ sessionExists: false }), {
        sessionId: SESSION,
        content: 'agenda',
      }),
    ).rejects.toThrow(/not found/);
  });

  it('scopes the write to the caller tenant', async () => {
    let params: unknown[] | undefined;
    await saveBrief(
      TC,
      makePostgres({ onQuery: (q, p) => { if (q.includes('INSERT INTO meeting_briefs')) params = p; } }),
      { sessionId: SESSION, content: 'agenda' },
    );
    expect(params).toContain(TC.tenantId);
    expect(params).toContain(TC.userId);
  });
});

describe('getBrief', () => {
  it('returns the brief when one exists', async () => {
    const brief = await getBrief(TC, makePostgres({}), SESSION);
    expect(brief?.content).toContain('iTrendFast');
  });

  it('returns null when the session has no brief', async () => {
    // Meetings without an agenda are the normal case and must not error.
    expect(await getBrief(TC, makePostgres({ briefRow: null }), SESSION)).toBeNull();
  });
});

describe('deleteBrief', () => {
  it('reports whether anything was removed', async () => {
    expect(await deleteBrief(TC, makePostgres({}), SESSION)).toBe(true);
    expect(await deleteBrief(TC, makePostgres({ briefRow: null }), SESSION)).toBe(false);
  });
});
