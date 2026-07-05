import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildWebhookRouter } from '../src/webhook.js';
import type { Logger } from '@voai/types';
import type { PostgresClient } from '@voai/db';

function makeLogger(): Logger {
  const log: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => log,
  };
  return log;
}

function makePostgres(rowsOverride?: unknown[]): PostgresClient {
  return {
    adminQuery: vi.fn().mockResolvedValue(rowsOverride ?? [{ id: 'tenant-1' }]),
    withTenant: vi.fn(),
  } as unknown as PostgresClient;
}

describe('stripe webhook endpoint', () => {
  let server: Server;
  let baseUrl: string;
  let postgres: ReturnType<typeof makePostgres>;

  beforeEach(async () => {
    postgres = makePostgres();
    const app = express();
    // Raw body needed — same as production wiring
    app.use(express.raw({ type: 'application/json', limit: '256kb' }));
    app.use(buildWebhookRouter(postgres, makeLogger()));

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.restoreAllMocks();
  });

  it('returns 200 and stub mode when STRIPE_SECRET_KEY is absent', async () => {
    delete process.env['STRIPE_SECRET_KEY'];
    const res = await fetch(`${baseUrl}/billing/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'customer.subscription.created' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('stub');
  });

  it('updates tenant plan on subscription.created when STRIPE_WEBHOOK_SECRET absent (dev)', async () => {
    process.env['STRIPE_SECRET_KEY'] = 'sk_test_fake';
    delete process.env['STRIPE_WEBHOOK_SECRET'];

    const event = {
      type: 'customer.subscription.created',
      data: {
        object: {
          customer: 'cus_123',
          // Use the default placeholder — PRICE_TO_TIER is built at module load time
          items: { data: [{ price: { id: 'price_growth_placeholder' } }] },
          status: 'active',
        },
      },
    };

    const res = await fetch(`${baseUrl}/billing/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);

    // Allow the async handler to complete
    await new Promise((r) => setTimeout(r, 20));
    expect(postgres.adminQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE identity_tenants'),
      expect.arrayContaining(['growth', 'active', 'cus_123']),
    );

    delete process.env['STRIPE_SECRET_KEY'];
    delete process.env['STRIPE_PRICE_GROWTH'];
  });

  it('sets plan to starter and status to cancelled on subscription.deleted', async () => {
    process.env['STRIPE_SECRET_KEY'] = 'sk_test_fake';
    delete process.env['STRIPE_WEBHOOK_SECRET'];

    const event = {
      type: 'customer.subscription.deleted',
      data: {
        object: {
          customer: 'cus_456',
          items: { data: [{ price: { id: 'price_starter_placeholder' } }] },
          status: 'canceled',
        },
      },
    };

    const res = await fetch(`${baseUrl}/billing/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 20));
    expect(postgres.adminQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE identity_tenants'),
      expect.arrayContaining(['starter', 'cancelled', 'cus_456']),
    );

    delete process.env['STRIPE_SECRET_KEY'];
  });

  it('returns 400 when Stripe signature is invalid', async () => {
    process.env['STRIPE_SECRET_KEY'] = 'sk_test_fake';
    process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_fake';

    const res = await fetch(`${baseUrl}/billing/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 't=bad,v1=badsig',
      },
      body: JSON.stringify({ type: 'customer.subscription.created' }),
    });
    expect(res.status).toBe(400);

    delete process.env['STRIPE_SECRET_KEY'];
    delete process.env['STRIPE_WEBHOOK_SECRET'];
  });
});
