import { describe, expect, it, vi } from 'vitest';
import { parseCron, shouldRun, CronRunner } from '../src/cron.js';

describe('parseCron', () => {
  it('parses a valid 5-field cron expression', () => {
    const expr = parseCron('0 8 * * *');
    expect(expr.minute).toBe('0');
    expect(expr.hour).toBe('8');
    expect(expr.dayOfMonth).toBe('*');
    expect(expr.month).toBe('*');
    expect(expr.dayOfWeek).toBe('*');
  });

  it('throws on invalid expression (wrong field count)', () => {
    expect(() => parseCron('0 8 *')).toThrow('5 fields');
    expect(() => parseCron('0 8 * * * *')).toThrow('5 fields');
  });

  it('parses comma-separated values', () => {
    const expr = parseCron('0,30 8,9 * * 1,5');
    expect(expr.minute).toBe('0,30');
    expect(expr.hour).toBe('8,9');
    expect(expr.dayOfWeek).toBe('1,5');
  });
});

describe('shouldRun', () => {
  it('returns true when all fields match', () => {
    const expr = parseCron('0 8 * * *');
    const date = new Date('2024-01-15T08:00:00Z'); // Monday, 08:00 UTC
    expect(shouldRun(expr, date)).toBe(true);
  });

  it('returns false when minute does not match', () => {
    const expr = parseCron('0 8 * * *');
    const date = new Date('2024-01-15T08:30:00Z');
    expect(shouldRun(expr, date)).toBe(false);
  });

  it('returns false when hour does not match', () => {
    const expr = parseCron('0 8 * * *');
    const date = new Date('2024-01-15T09:00:00Z');
    expect(shouldRun(expr, date)).toBe(false);
  });

  it('wildcard * matches any value', () => {
    const expr = parseCron('* * * * *');
    expect(shouldRun(expr, new Date('2024-06-15T14:37:00Z'))).toBe(true);
  });

  it('matches comma-separated hour values', () => {
    const expr = parseCron('0 8,18 * * *');
    expect(shouldRun(expr, new Date('2024-01-15T08:00:00Z'))).toBe(true);
    expect(shouldRun(expr, new Date('2024-01-15T18:00:00Z'))).toBe(true);
    expect(shouldRun(expr, new Date('2024-01-15T12:00:00Z'))).toBe(false);
  });

  it('matches specific day of week', () => {
    const expr = parseCron('0 9 * * 1'); // Monday
    const monday = new Date('2024-01-15T09:00:00Z'); // Monday
    const tuesday = new Date('2024-01-16T09:00:00Z'); // Tuesday
    expect(shouldRun(expr, monday)).toBe(true);
    expect(shouldRun(expr, tuesday)).toBe(false);
  });
});

describe('CronRunner', () => {
  it('registers jobs and exposes their names', () => {
    const runner = new CronRunner();
    runner.register({ name: 'job-a', expression: parseCron('0 8 * * *'), handler: async () => {} });
    runner.register({ name: 'job-b', expression: parseCron('0 9 * * *'), handler: async () => {} });
    expect(runner.jobNames).toEqual(['job-a', 'job-b']);
  });

  it('runNow calls the handler immediately', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const runner = new CronRunner();
    runner.register({ name: 'test-job', expression: parseCron('0 8 * * *'), handler });
    await runner.runNow('test-job');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('runNow throws for unknown job name', async () => {
    const runner = new CronRunner();
    await expect(runner.runNow('nonexistent')).rejects.toThrow('nonexistent');
  });

  it('stop clears the interval without throwing', () => {
    const runner = new CronRunner();
    runner.stop(); // should be a no-op when not started
    expect(runner.jobNames).toHaveLength(0);
  });
});
