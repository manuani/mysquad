import { describe, expect, it } from 'vitest';
import { getAvailableSlots } from '../src/booking.js';
import type { TenantContext } from '@voai/auth-context';

const TC: TenantContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  userType: 'founder',
  sessionId: 'sess-1',
};

function makeClient(availabilityRows: Array<{ start_utc_min: number; end_utc_min: number }>) {
  return {
    async query(_sql: string, _params: unknown[]) {
      return { rows: availabilityRows };
    },
  };
}

describe('getAvailableSlots', () => {
  it('returns empty array when expert has no availability on that day', async () => {
    const client = makeClient([]);
    const slots = await getAvailableSlots(TC, client as never, 'exp-1', '2024-01-15');
    expect(slots).toHaveLength(0);
  });

  it('generates 30-minute slots within a window', async () => {
    // 09:00–10:30 UTC = minutes 540–630 → 3 slots (540, 570, 600)
    const client = makeClient([{ start_utc_min: 540, end_utc_min: 630 }]);
    const slots = await getAvailableSlots(TC, client as never, 'exp-1', '2024-01-15');
    expect(slots).toHaveLength(3);
    expect(slots[0]!.durationMinutes).toBe(30);
  });

  it('slot start times are 30 minutes apart', async () => {
    const client = makeClient([{ start_utc_min: 480, end_utc_min: 600 }]);
    const slots = await getAvailableSlots(TC, client as never, 'exp-1', '2024-01-15');
    expect(slots.length).toBeGreaterThanOrEqual(2);
    const t0 = new Date(slots[0]!.startUtc).getTime();
    const t1 = new Date(slots[1]!.startUtc).getTime();
    expect(t1 - t0).toBe(30 * 60_000);
  });

  it('slot end time is exactly 30 minutes after start', async () => {
    const client = makeClient([{ start_utc_min: 480, end_utc_min: 510 }]);
    const slots = await getAvailableSlots(TC, client as never, 'exp-1', '2024-01-15');
    expect(slots).toHaveLength(1);
    const start = new Date(slots[0]!.startUtc).getTime();
    const end = new Date(slots[0]!.endUtc).getTime();
    expect(end - start).toBe(30 * 60_000);
  });

  it('throws ValidationError for invalid date format', async () => {
    const client = makeClient([]);
    await expect(
      getAvailableSlots(TC, client as never, 'exp-1', 'not-a-date'),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('slots span the correct UTC date', async () => {
    const client = makeClient([{ start_utc_min: 0, end_utc_min: 30 }]);
    const slots = await getAvailableSlots(TC, client as never, 'exp-1', '2024-03-20');
    expect(slots[0]!.startUtc).toContain('2024-03-20');
  });
});
