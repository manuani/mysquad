import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildAdminRouter } from '../src/routes.js';

const mockLog = { info: () => {}, error: () => {}, child: () => mockLog } as never;

function makePostgres() {
  return {
    async adminQuery(_sql: string, _params?: unknown[]) {
      if (_sql.includes('COUNT')) return [{ count: '2' }];
      return [
        { tenant_id: 't1', name: 'Alpha', email: 'a@x.com', plan: 'starter', status: 'active', created_at: new Date(), total_cost_micro_this_month: 0, total_roster_calls_this_month: 0 },
        { tenant_id: 't2', name: 'Beta', email: 'b@x.com', plan: 'growth', status: 'active', created_at: new Date(), total_cost_micro_this_month: 5000, total_roster_calls_this_month: 10 },
      ];
    },
    withTenant: async () => null,
  };
}

function buildApp(adminKey = 'secret') {
  const app = express();
  app.use(express.json());
  app.use(buildAdminRouter(makePostgres() as never, mockLog, adminKey));
  return app;
}

describe('requireAdminKey', () => {
  it('returns 401 when x-admin-key is missing', async () => {
    const res = await request(buildApp()).get('/tenants');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  it('returns 401 when x-admin-key is wrong', async () => {
    const res = await request(buildApp()).get('/tenants').set('x-admin-key', 'bad-key');
    expect(res.status).toBe(401);
  });

  it('passes with correct x-admin-key', async () => {
    const res = await request(buildApp()).get('/tenants').set('x-admin-key', 'secret');
    expect(res.status).toBe(200);
  });
});

describe('GET /tenants', () => {
  it('returns tenant list with total count', async () => {
    const res = await request(buildApp()).get('/tenants').set('x-admin-key', 'secret');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.tenants).toHaveLength(2);
    expect(res.body.tenants[0].tenantId).toBe('t1');
  });
});

describe('POST /tenants', () => {
  it('returns 400 VALIDATION_FAILED when name missing', async () => {
    const res = await request(buildApp())
      .post('/tenants')
      .set('x-admin-key', 'secret')
      .send({ email: 'x@y.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
  });

  it('returns 400 VALIDATION_FAILED when email missing', async () => {
    const res = await request(buildApp())
      .post('/tenants')
      .set('x-admin-key', 'secret')
      .send({ name: 'NewCo' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
  });

  it('provisions tenant and returns 201 with tenantId', async () => {
    const provisionPostgres = {
      async adminQuery(_sql: string, _params?: unknown[]) {
        return [{ id: 'new-tid', email: 'newco@x.com', plan: 'starter' }];
      },
      withTenant: async () => null,
    };
    const app = express();
    app.use(express.json());
    app.use(buildAdminRouter(provisionPostgres as never, mockLog, 'secret'));
    const res = await request(app)
      .post('/tenants')
      .set('x-admin-key', 'secret')
      .send({ name: 'NewCo', email: 'newco@x.com' });
    expect(res.status).toBe(201);
    expect(res.body.tenantId).toBe('new-tid');
  });
});
