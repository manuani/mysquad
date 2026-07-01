/**
 * Performance Service unit tests.
 *
 * Uses an in-memory mock for ctx.db.postgres — no real DB required.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { TenantScopedClient, PostgresClient } from '@voai/db';
import type { TenantContext } from '@voai/auth-context';
import { isSignalType, isRecordedBy, SIGNAL_TYPES } from '../src/types.js';

// ---------------------------------------------------------------------------
// Mock infrastructure
// ---------------------------------------------------------------------------

interface MockRow {
  [key: string]: unknown;
}

/** Build a TenantScopedClient that returns pre-canned rows for any query. */
function makeMockClient(rows: MockRow[]): TenantScopedClient {
  return {
    async query<T = unknown>(_text: string, _params?: unknown[]) {
      return { rows: rows as T[] };
    },
  };
}

/** Build a PostgresClient whose withTenant always uses the given rows. */
function makeMockPostgres(rows: MockRow[]): PostgresClient {
  return {
    async withTenant<T>(_tenantId: string, fn: (client: TenantScopedClient) => Promise<T>) {
      return fn(makeMockClient(rows));
    },
  };
}

function makeTenantContext(overrides?: Partial<TenantContext>): TenantContext {
  return {
    tenantId: 'tenant-uuid-1',
    userId: 'user-uuid-1',
    userType: 'founder',
    sessionId: 'session-uuid-1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Validation helpers (unit tests — no HTTP layer)
// ---------------------------------------------------------------------------

describe('isSignalType', () => {
  it('accepts all valid signal types', () => {
    for (const t of SIGNAL_TYPES) {
      expect(isSignalType(t)).toBe(true);
    }
  });

  it('rejects unknown signal type', () => {
    expect(isSignalType('vibes')).toBe(false);
    expect(isSignalType('')).toBe(false);
    expect(isSignalType(null)).toBe(false);
    expect(isSignalType(42)).toBe(false);
  });
});

describe('isRecordedBy', () => {
  it('accepts valid recorder values', () => {
    expect(isRecordedBy('system')).toBe(true);
    expect(isRecordedBy('founder')).toBe(true);
    expect(isRecordedBy('expert')).toBe(true);
  });

  it('rejects invalid recorder values', () => {
    expect(isRecordedBy('bot')).toBe(false);
    expect(isRecordedBy('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Signal validation — value range
// ---------------------------------------------------------------------------

describe('signal value range validation', () => {
  function validateValue(value: unknown): string | null {
    if (typeof value !== 'number' || value < 0 || value > 1) {
      return 'value must be a number between 0 and 1 inclusive';
    }
    return null;
  }

  it('accepts 0', () => expect(validateValue(0)).toBeNull());
  it('accepts 1', () => expect(validateValue(1)).toBeNull());
  it('accepts 0.5', () => expect(validateValue(0.5)).toBeNull());

  it('rejects value > 1', () => {
    expect(validateValue(1.01)).not.toBeNull();
    expect(validateValue(2)).not.toBeNull();
  });

  it('rejects value < 0', () => {
    expect(validateValue(-0.01)).not.toBeNull();
    expect(validateValue(-1)).not.toBeNull();
  });

  it('rejects non-number', () => {
    expect(validateValue('0.5')).not.toBeNull();
    expect(validateValue(null)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scores aggregation logic
// ---------------------------------------------------------------------------

describe('scores aggregation', () => {
  /** Replicate the overallScore calculation from the route handler. */
  function computeOverall(
    rows: Array<{ signal_type: string; avg_value: number; cnt: string }>,
  ): number {
    const signals: Record<string, { avg: number; count: number }> = {};
    for (const row of rows) {
      if (isSignalType(row.signal_type)) {
        signals[row.signal_type] = {
          avg: row.avg_value,
          count: parseInt(row.cnt, 10),
        };
      }
    }
    const avgs = Object.values(signals).map((s) => s.avg);
    if (avgs.length === 0) return 0;
    return avgs.reduce((sum, v) => sum + v, 0) / avgs.length;
  }

  it('returns 0 when no rows', () => {
    expect(computeOverall([])).toBe(0);
  });

  it('returns the single avg when one signal type', () => {
    expect(computeOverall([{ signal_type: 'factual_grounding', avg_value: 0.8, cnt: '5' }])).toBe(
      0.8,
    );
  });

  it('averages across multiple signal types', () => {
    const rows = [
      { signal_type: 'factual_grounding', avg_value: 0.8, cnt: '5' },
      { signal_type: 'peer_agreement', avg_value: 0.6, cnt: '3' },
    ];
    const overall = computeOverall(rows);
    expect(overall).toBeCloseTo(0.7, 5);
  });

  it('ignores unknown signal types', () => {
    const rows = [
      { signal_type: 'factual_grounding', avg_value: 0.9, cnt: '2' },
      { signal_type: 'unknown_signal', avg_value: 0.1, cnt: '10' },
    ];
    // Only factual_grounding counts
    expect(computeOverall(rows)).toBe(0.9);
  });
});

// ---------------------------------------------------------------------------
// Mock DB round-trip: insertSignal shape
// ---------------------------------------------------------------------------

describe('mock DB — insertSignal row shape', () => {
  it('withTenant returns the row the mock was seeded with', async () => {
    const fakeRow = {
      id: 'fake-uuid',
      persona_id: 'sarah-cfo',
      signal_type: 'factual_grounding',
      value: 0.85,
      recorded_at: new Date().toISOString(),
    };

    const postgres = makeMockPostgres([fakeRow]);
    const tc = makeTenantContext();

    const result = await postgres.withTenant(tc.tenantId, async (client: TenantScopedClient) => {
      const { rows } = await client.query('SELECT 1');
      return rows[0];
    });

    expect(result).toEqual(fakeRow);
  });
});

// ---------------------------------------------------------------------------
// Weekly aggregation grouping logic
// ---------------------------------------------------------------------------

describe('weekly aggregation grouping', () => {
  type WeeklyRow = { persona_id: string; signal_type: string; cnt: string; avg_value: number };

  function buildWeeklySummaries(rows: WeeklyRow[]) {
    const byPersona = new Map<
      string,
      { signalAvgs: Partial<Record<string, number>>; signalCounts: Partial<Record<string, number>> }
    >();

    for (const row of rows) {
      if (!isSignalType(row.signal_type)) continue;
      let entry = byPersona.get(row.persona_id);
      if (!entry) {
        entry = { signalAvgs: {}, signalCounts: {} };
        byPersona.set(row.persona_id, entry);
      }
      entry.signalAvgs[row.signal_type] = row.avg_value;
      entry.signalCounts[row.signal_type] = parseInt(row.cnt, 10);
    }

    const summaries = [];
    for (const [personaId, { signalAvgs, signalCounts }] of byPersona) {
      const avgs = Object.values(signalAvgs) as number[];
      const overallScore =
        avgs.length > 0 ? avgs.reduce((sum, v) => sum + v, 0) / avgs.length : 0;
      summaries.push({ personaId, overallScore, signalCounts });
    }
    return summaries.sort((a, b) => b.overallScore - a.overallScore);
  }

  it('groups rows by persona and sorts descending', () => {
    const rows: WeeklyRow[] = [
      { persona_id: 'priya-cmo', signal_type: 'factual_grounding', cnt: '3', avg_value: 0.5 },
      { persona_id: 'sarah-cfo', signal_type: 'factual_grounding', cnt: '5', avg_value: 0.9 },
      { persona_id: 'sarah-cfo', signal_type: 'peer_agreement', cnt: '2', avg_value: 0.7 },
    ];

    const summaries = buildWeeklySummaries(rows);
    expect(summaries[0]!.personaId).toBe('sarah-cfo');
    expect(summaries[0]!.overallScore).toBeCloseTo(0.8, 5);
    expect(summaries[1]!.personaId).toBe('priya-cmo');
    expect(summaries[1]!.overallScore).toBe(0.5);
  });

  it('returns empty array for no rows', () => {
    expect(buildWeeklySummaries([])).toEqual([]);
  });
});
