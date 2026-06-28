import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '@voai/auth-context';
import type { PostgresClient, TenantScopedClient } from '@voai/db';
import type { LlmCompletionRequest, LlmCompletionResult, RoutingService } from '@voai/routing';
import { buildAgentRuntimeRouter } from '../src/routes.js';

/** Fake Postgres with no brain content — these tests aren't about continuity. */
function makeFakePostgres(): PostgresClient {
  const client: TenantScopedClient = { query: async () => ({ rows: [] }) };
  return { withTenant: async (_tenantId, fn) => fn(client) };
}

const TENANT_HEADERS = {
  'x-tenant-id': 'tenant-1',
  'x-user-id': 'user-1',
  'x-user-type': 'founder',
  'x-session-id': 'session-1',
};

const noopLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(() => noopLogger),
};

function makeFakeRoutingService(
  completeImpl: (request: LlmCompletionRequest) => Promise<LlmCompletionResult>,
): RoutingService {
  return {
    complete: vi.fn(async (_tenantContext: TenantContext, request: LlmCompletionRequest) =>
      completeImpl(request),
    ),
  } as unknown as RoutingService;
}

describe('agent-runtime routes', () => {
  let server: Server;
  let baseUrl: string;
  let routingService: RoutingService;

  beforeEach(async () => {
    routingService = makeFakeRoutingService(async () => ({
      content: "Based on your numbers, you have about five months of runway.",
      model: 'fake-model',
      usage: { inputTokens: 42, outputTokens: 18 },
    }));

    const app = express();
    app.use(express.json());
    app.use(buildAgentRuntimeRouter(routingService, noopLogger, makeFakePostgres()));

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.clearAllMocks();
  });

  it('POST /contributions returns Sarah CFO contribution shaped correctly', async () => {
    const res = await fetch(`${baseUrl}/contributions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({ message: 'How much runway do we have?' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agentName).toBe('Sarah Chen');
    expect(body.content).toBe('Based on your numbers, you have about five months of runway.');
    expect(typeof body.generatedAt).toBe('string');
  });

  it('passes the system prompt and message through to the routing service', async () => {
    await fetch(`${baseUrl}/contributions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({ message: 'What is our burn rate?' }),
    });

    expect(routingService.complete).toHaveBeenCalledTimes(1);
    const [tenantContextArg, requestArg] = (routingService.complete as ReturnType<typeof vi.fn>).mock
      .calls[0] as [TenantContext, LlmCompletionRequest];
    expect(tenantContextArg).toEqual({
      tenantId: 'tenant-1',
      userId: 'user-1',
      userType: 'founder',
      sessionId: 'session-1',
    });
    expect(requestArg.systemPrompt).toContain('Sarah Chen');
    expect(requestArg.messages).toEqual([{ role: 'user', content: 'What is our burn rate?' }]);
  });

  it('POST /contributions without a message returns 400', async () => {
    const res = await fetch(`${baseUrl}/contributions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_FAILED');
  });

  it('POST /contributions without tenant headers returns an error, not a crash', async () => {
    const res = await fetch(`${baseUrl}/contributions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('INTERNAL');
  });

  it('logs unexpected errors from the routing service rather than swallowing them', async () => {
    routingService = makeFakeRoutingService(async () => {
      throw new Error('provider unavailable');
    });
    const app = express();
    app.use(express.json());
    app.use(buildAgentRuntimeRouter(routingService, noopLogger, makeFakePostgres()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;

    const res = await fetch(`${baseUrl}/contributions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({ message: 'hello' }),
    });

    expect(res.status).toBe(500);
    expect(noopLogger.error).toHaveBeenCalledWith(
      'unexpected error in agent-runtime route',
      expect.objectContaining({ err: expect.stringContaining('provider unavailable') }),
    );
  });
});
