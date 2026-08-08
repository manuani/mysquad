/**
 * The point of these tests is that the health check can actually fail.
 *
 * Every module used to return a hardcoded `{ status: 'healthy' }`, so
 * `GET /healthz` stayed green while Postgres was down. A probe that cannot
 * report failure is worse than no probe: load balancers and deploy gates read
 * it as success during an outage.
 */

import { describe, expect, it, vi } from 'vitest';
import { checkDependencies } from '../src/health.js';
import type { Neo4jClient, PostgresClient, RedisClient } from '../src/index.js';

function pg(ping: () => Promise<void>): PostgresClient {
  return { withTenant: vi.fn(), adminQuery: vi.fn(), ping } as unknown as PostgresClient;
}
function neo(ping: () => Promise<void>): Neo4jClient {
  return { session: vi.fn(), ping } as unknown as Neo4jClient;
}
function redis(ping: () => Promise<void>): RedisClient {
  return { get: vi.fn(), set: vi.fn(), del: vi.fn(), ping } as unknown as RedisClient;
}

const up = () => Promise.resolve();
const down = (msg: string) => () => Promise.reject(new Error(msg));

describe('checkDependencies', () => {
  it('is healthy when every dependency answers', async () => {
    const status = await checkDependencies({
      postgres: pg(up),
      neo4j: neo(up),
      redis: redis(up),
    });
    expect(status).toEqual({ status: 'healthy' });
  });

  it('is unhealthy when a dependency is unreachable', async () => {
    const status = await checkDependencies({ postgres: pg(down('ECONNREFUSED 127.0.0.1:5432')) });
    expect(status.status).toBe('unhealthy');
    expect(status).toHaveProperty('reason');
  });

  it('names which dependency failed', async () => {
    const status = await checkDependencies({
      postgres: pg(up),
      neo4j: neo(down('Neo4jError: unauthorized')),
    });
    expect(status.status).toBe('unhealthy');
    expect((status as { reason: string }).reason).toContain('neo4j');
    expect((status as { reason: string }).reason).toContain('unauthorized');
    // postgres was fine, so it should not be blamed
    expect((status as { reason: string }).reason).not.toContain('postgres');
  });

  it('reports every failure, not just the first', async () => {
    const status = await checkDependencies({
      postgres: pg(down('pg is down')),
      redis: redis(down('redis is down')),
    });
    const reason = (status as { reason: string }).reason;
    expect(reason).toContain('postgres');
    expect(reason).toContain('redis');
  });

  it('probes only the dependencies it was given', async () => {
    const neo4jPing = vi.fn(up);
    await checkDependencies({ postgres: pg(up) });
    expect(neo4jPing).not.toHaveBeenCalled();
  });

  it('is healthy when a module declares no dependencies', async () => {
    expect(await checkDependencies({})).toEqual({ status: 'healthy' });
  });

  it('fails a dependency that hangs instead of hanging the health check', async () => {
    vi.useFakeTimers();
    try {
      // A store that accepts connections but never answers — the case a plain
      // `await ping()` would wait on forever, blocking /healthz.
      const status$ = checkDependencies({ postgres: pg(() => new Promise<void>(() => {})) });
      await vi.advanceTimersByTimeAsync(2_500);
      const status = await status$;

      expect(status.status).toBe('unhealthy');
      expect((status as { reason: string }).reason).toContain('did not respond');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not leave a pending timer behind after a fast probe', async () => {
    vi.useFakeTimers();
    try {
      await checkDependencies({ postgres: pg(up) });
      // A leaked per-probe timeout would keep the event loop alive in a
      // long-running process that health-checks on an interval.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('failure descriptions', () => {
  it('describes an AggregateError, whose own message is empty', async () => {
    // Node reports a refused connection this way: message '', detail in
    // `code` and `errors[]`. Reading `.message` alone yields "postgres: ".
    const refused = new AggregateError(
      [new Error('connect ECONNREFUSED ::1:5432'), new Error('connect ECONNREFUSED 127.0.0.1:5432')],
      '',
    );
    (refused as { code?: string }).code = 'ECONNREFUSED';

    const status = await checkDependencies({ postgres: pg(() => Promise.reject(refused)) });
    const reason = (status as { reason: string }).reason;

    expect(reason).not.toBe('postgres: ');
    expect(reason).toContain('5432');
  });

  it('includes the error code alongside a non-empty message', async () => {
    const err = Object.assign(new Error('password authentication failed'), { code: '28P01' });
    const status = await checkDependencies({ postgres: pg(() => Promise.reject(err)) });

    const reason = (status as { reason: string }).reason;
    expect(reason).toContain('password authentication failed');
    expect(reason).toContain('28P01');
  });

  it('falls back to the code when there is no message or sub-error', async () => {
    const err = Object.assign(new AggregateError([], ''), { code: 'ETIMEDOUT' });
    const status = await checkDependencies({ redis: redis(() => Promise.reject(err)) });
    expect((status as { reason: string }).reason).toContain('ETIMEDOUT');
  });

  it('handles a non-Error rejection without crashing the health check', async () => {
    const status = await checkDependencies({ postgres: pg(() => Promise.reject('just a string')) });
    expect(status.status).toBe('unhealthy');
    expect((status as { reason: string }).reason).toContain('just a string');
  });
});
