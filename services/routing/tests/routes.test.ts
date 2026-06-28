import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformError } from '@voai/errors';
import { buildRoutingRouter } from '../src/routes.js';
import type { RoutingService } from '../src/routing-service.js';

const TENANT_HEADERS = {
  'x-tenant-id': 'tenant-1',
  'x-user-id': 'user-1',
  'x-user-type': 'founder',
  'x-session-id': 'session-1',
};

describe('routing routes', () => {
  let server: Server;
  let baseUrl: string;
  let routingService: { complete: ReturnType<typeof vi.fn> };

  function startApp() {
    const app = express();
    app.use(express.json());
    app.use(buildRoutingRouter(routingService as unknown as RoutingService));
    return app;
  }

  beforeEach(async () => {
    routingService = { complete: vi.fn() };
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  async function listen(app: express.Express): Promise<void> {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  }

  it('returns an error (tenant context resolution throws) when tenant headers are missing', async () => {
    // Matches services/ledger/tests/routes.test.ts: MissingTenantContextError
    // is not a PlatformError, so it falls through to the generic 500
    // handler rather than a typed 4xx — tracked as the same interim gap.
    await listen(startApp());

    const res = await fetch(`${baseUrl}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ systemPrompt: 'sys', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(res.status).toBe(500);
    expect(routingService.complete).not.toHaveBeenCalled();
  });

  it('returns 400 when messages is missing or malformed', async () => {
    await listen(startApp());

    const res = await fetch(`${baseUrl}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({ systemPrompt: 'sys' }),
    });

    expect(res.status).toBe(400);
    expect(routingService.complete).not.toHaveBeenCalled();
  });

  it('dispatches a valid request to RoutingService.complete with the parsed tenant context', async () => {
    const result = { content: 'hi there', model: 'fake-model', usage: { inputTokens: 1, outputTokens: 1 } };
    routingService.complete.mockResolvedValue(result);
    await listen(startApp());

    const res = await fetch(`${baseUrl}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 100,
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
    expect(routingService.complete).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', userId: 'user-1', userType: 'founder', sessionId: 'session-1' },
      { systemPrompt: 'sys', messages: [{ role: 'user', content: 'hi' }], maxTokens: 100 },
    );
  });

  it('maps a PlatformError thrown by RoutingService to its httpStatus/code', async () => {
    routingService.complete.mockRejectedValue(
      new PlatformError('PROVIDER_UNAVAILABLE', 503, 'no key configured'),
    );
    await listen(startApp());

    const res = await fetch(`${baseUrl}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({ systemPrompt: 'sys', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({ error: 'PROVIDER_UNAVAILABLE', message: 'no key configured' }));
  });
});
