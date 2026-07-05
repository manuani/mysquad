import type { AddressInfo } from 'node:net';
import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditMiddleware } from '../src/middleware.js';

function makePostgres() {
  const queryFn = vi.fn().mockResolvedValue({ rows: [] });
  const postgres = {
    withTenant: vi.fn((_id: string, fn: (c: unknown) => Promise<unknown>) =>
      fn({ query: queryFn }),
    ),
    queryFn,
    adminQuery: vi.fn().mockResolvedValue([]),
  };
  return postgres;
}

describe('auditMiddleware', () => {
  let server: Server;
  let baseUrl: string;
  let postgres: ReturnType<typeof makePostgres>;

  beforeEach(async () => {
    postgres = makePostgres();
    const app = express();
    app.use(express.json());
    app.use(auditMiddleware(postgres as never));

    app.post('/test', (_req, res) => res.status(201).json({ ok: true }));
    app.get('/test', (_req, res) => res.status(200).json({ ok: true }));
    app.delete('/fail', (_req, res) => res.status(500).json({ error: 'boom' }));

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('records a success audit event for POST', async () => {
    await fetch(`${baseUrl}/test`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': 'tenant-1',
        'x-user-id': 'user-1',
        'x-user-type': 'founder',
      },
      body: JSON.stringify({}),
    });
    // audit is fire-and-forget on 'finish' — give it a tick
    await new Promise((r) => setTimeout(r, 20));

    expect(postgres.withTenant).toHaveBeenCalled();
    const [sql, params] = postgres.queryFn.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO audit_log');
    expect(params[6]).toBe('success');
  });

  it('does NOT record for GET requests', async () => {
    await fetch(`${baseUrl}/test`);
    await new Promise((r) => setTimeout(r, 20));

    expect(postgres.withTenant).not.toHaveBeenCalled();
  });

  it('records outcome=failure for 5xx responses', async () => {
    await fetch(`${baseUrl}/fail`, { method: 'DELETE' });
    await new Promise((r) => setTimeout(r, 20));

    const params = postgres.queryFn.mock.calls[0]![1] as unknown[];
    expect(params[6]).toBe('failure');
  });
});
