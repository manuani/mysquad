import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildAdminRouter } from '../src/routes.js';

const mockLog = { info: () => {}, error: () => {}, warn: () => {}, child: () => mockLog } as never;
const KEY = 'test-key';

const USER_ROW = {
  user_id: 'u1',
  tenant_id: 't1',
  tenant_name: 'Alpha',
  email: 'alice@example.com',
  role: 'founder',
  active: true,
  created_at: new Date('2025-01-01'),
};

function makePostgres(overrides: Record<string, unknown> = {}) {
  return {
    async adminQuery(sql: string, _params?: unknown[]) {
      if (sql.includes('COUNT')) return [{ count: '1' }];
      if (sql.includes('INSERT INTO users') && sql.includes('ON CONFLICT')) {
        return [{ id: 'u1', email: 'alice@example.com', user_type: 'founder' }];
      }
      if (sql.includes('UPDATE users SET user_type')) {
        return overrides['roleUpdateResult'] ?? [{ ...USER_ROW }];
      }
      if (sql.includes('UPDATE users SET active = false')) {
        return overrides['deactivateResult'] ?? [{ id: 'u1' }];
      }
      if (sql.includes('UPDATE auth_sessions')) return [];
      // identity_tenants list (tenants route)
      if (sql.includes('identity_tenants')) return [];
      // users list
      return [USER_ROW];
    },
    withTenant: async () => null,
  };
}

function buildApp(pgOverrides: Record<string, unknown> = {}) {
  const app = express();
  app.use(express.json());
  app.use(buildAdminRouter(makePostgres(pgOverrides) as never, mockLog, KEY));
  return app;
}

describe('GET /tenants/:id/users', () => {
  it('returns 401 without admin key', async () => {
    const res = await request(buildApp()).get('/tenants/t1/users');
    expect(res.status).toBe(401);
  });

  it('returns user list with total', async () => {
    const res = await request(buildApp()).get('/tenants/t1/users').set('x-admin-key', KEY);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.users[0].userId).toBe('u1');
    expect(res.body.users[0].email).toBe('alice@example.com');
    expect(res.body.users[0].active).toBe(true);
  });
});

describe('POST /tenants/:id/users/invite', () => {
  it('returns 400 when email is missing', async () => {
    const res = await request(buildApp())
      .post('/tenants/t1/users/invite')
      .set('x-admin-key', KEY)
      .send({ role: 'admin' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when role is invalid', async () => {
    const res = await request(buildApp())
      .post('/tenants/t1/users/invite')
      .set('x-admin-key', KEY)
      .send({ email: 'bob@example.com', role: 'superuser' });
    expect(res.status).toBe(400);
  });

  it('returns 201 with userId and inviteToken', async () => {
    const res = await request(buildApp())
      .post('/tenants/t1/users/invite')
      .set('x-admin-key', KEY)
      .send({ email: 'alice@example.com', role: 'founder' });
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe('u1');
    expect(typeof res.body.inviteToken).toBe('string');
    expect(res.body.inviteToken.length).toBeGreaterThan(0);
  });
});

describe('PATCH /tenants/:id/users/:uid/role', () => {
  it('returns 400 for invalid role', async () => {
    const res = await request(buildApp())
      .patch('/tenants/t1/users/u1/role')
      .set('x-admin-key', KEY)
      .send({ role: 'god' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when user not found', async () => {
    const res = await request(buildApp({ roleUpdateResult: [] }))
      .patch('/tenants/t1/users/u-missing/role')
      .set('x-admin-key', KEY)
      .send({ role: 'admin' });
    expect(res.status).toBe(404);
  });

  it('returns 200 with updated user on success', async () => {
    const res = await request(buildApp())
      .patch('/tenants/t1/users/u1/role')
      .set('x-admin-key', KEY)
      .send({ role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('u1');
  });
});

describe('DELETE /tenants/:id/users/:uid', () => {
  it('returns 404 when user not found', async () => {
    const res = await request(buildApp({ deactivateResult: [] }))
      .delete('/tenants/t1/users/u-missing')
      .set('x-admin-key', KEY);
    expect(res.status).toBe(404);
  });

  it('returns 204 on successful deactivation', async () => {
    const res = await request(buildApp()).delete('/tenants/t1/users/u1').set('x-admin-key', KEY);
    expect(res.status).toBe(204);
  });
});
