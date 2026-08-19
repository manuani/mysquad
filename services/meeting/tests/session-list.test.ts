/**
 * Conversations were stored and restored, but the only way to resume one was to
 * already hold its session id — so in practice a meeting ended and was gone.
 * "Show me last Tuesday's conversation" had no answer.
 */

import { describe, expect, it, vi } from 'vitest';
import { listMeetings } from '../src/session-list.js';
import type { TenantContext } from '@voai/auth-context';
import type { PostgresClient } from '@voai/db';

const TC: TenantContext = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  userType: 'founder',
  sessionId: 'session-1',
};

function makePostgres(rows: Array<Record<string, unknown>> = []) {
  const captured: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      captured.push({ sql, params });
      return { rows };
    }),
  };
  const postgres = { withTenant: async (_t: string, fn: never) => (fn as never as (c: unknown) => unknown)(client) } as unknown as PostgresClient;
  return { postgres, captured };
}

const ROW = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  status: 'ended',
  mode: 'voice',
  created_at: new Date('2026-08-18T09:00:00Z'),
  ended_at: new Date('2026-08-18T09:40:00Z'),
  title: 'Pricing review',
  opening_line: 'We need to rethink pricing for iTrendFast.',
  advisors: ['Sarah Chen', 'Marcus Webb'],
  turn_count: '12',
};

describe('listMeetings', () => {
  it('returns what is needed to recognise a meeting from one row', async () => {
    const { postgres } = makePostgres([ROW]);
    const [meeting] = await listMeetings(TC, postgres);

    expect(meeting).toMatchObject({
      id: ROW.id,
      title: 'Pricing review',
      openingLine: 'We need to rethink pricing for iTrendFast.',
      advisors: ['Sarah Chen', 'Marcus Webb'],
      turnCount: 12,
      status: 'ended',
    });
    expect(meeting!.endedAt).toBe('2026-08-18T09:40:00.000Z');
  });

  it('hides meetings with nothing in them', async () => {
    // A session is created on join, so abandoned joins would otherwise
    // dominate the list.
    const { postgres, captured } = makePostgres();
    await listMeetings(TC, postgres);

    const sql = captured[0]!.sql;
    expect(sql).toContain('EXISTS (SELECT 1 FROM transcript_entries');
    expect(sql).toContain('b.session_id IS NOT NULL');
  });

  it('searches what was said, not only the agenda', async () => {
    // Someone looking for "the pricing conversation" is remembering what was
    // discussed, not what the meeting was called.
    const { postgres, captured } = makePostgres();
    await listMeetings(TC, postgres, { query: 'pricing' });

    const { sql, params } = captured[0]!;
    expect(sql).toContain('b.title ILIKE');
    expect(sql).toContain('b.content ILIKE');
    expect(sql).toContain('te.content ILIKE');
    expect(params).toContain('pricing');
  });

  it('treats a blank query as no filter', async () => {
    const { postgres, captured } = makePostgres();
    await listMeetings(TC, postgres, { query: '   ' });
    expect(captured[0]!.params).toContain(null);
  });

  it('orders by most recent activity', async () => {
    const { postgres, captured } = makePostgres();
    await listMeetings(TC, postgres);
    expect(captured[0]!.sql).toContain('ORDER BY COALESCE(s.ended_at, s.created_at) DESC');
  });

  it('caps the page size however large a limit is asked for', async () => {
    const { postgres, captured } = makePostgres();
    await listMeetings(TC, postgres, { limit: 10_000 });
    expect(captured[0]!.params?.[0]).toBe(100);
  });

  it('rejects a nonsensical limit rather than querying with it', async () => {
    const { postgres, captured } = makePostgres();
    await listMeetings(TC, postgres, { limit: 0 });
    expect(captured[0]!.params?.[0]).toBe(1);
  });

  it('copes with a meeting nobody has spoken in yet', async () => {
    const { postgres } = makePostgres([
      { ...ROW, advisors: null, opening_line: null, title: null, turn_count: '0', ended_at: null },
    ]);
    const [meeting] = await listMeetings(TC, postgres);

    expect(meeting!.advisors).toEqual([]);
    expect(meeting!.openingLine).toBeNull();
    expect(meeting!.endedAt).toBeNull();
    expect(meeting!.turnCount).toBe(0);
  });

  it('scopes the read to the caller tenant', async () => {
    const withTenant = vi.fn(async (_t: string, fn: never) =>
      (fn as never as (c: unknown) => unknown)({ query: async () => ({ rows: [] }) }),
    );
    await listMeetings(TC, { withTenant } as unknown as PostgresClient);
    expect(withTenant).toHaveBeenCalledWith(TC.tenantId, expect.any(Function));
  });
});
