import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabaseClients, type DatabaseClients } from '../../src/index.js';

/**
 * Exercises the System Architecture §8.1.1 tenant boundary end to end
 * against a live Postgres instance: a founder in tenant A cannot read
 * tenant B's data through `withTenant`, because row-level security
 * (layer 4) enforces it at the database regardless of what the
 * application layer asks for.
 *
 * Requires the Docker Compose stack (`infra/docker/docker-compose.yml`)
 * running with the baseline migration applied:
 *
 *   docker compose -f infra/docker/docker-compose.yml up -d
 *   pnpm run db:migrate
 *   pnpm run test:integration
 */

const SYSTEM_TENANT = '00000000-0000-0000-0000-000000000000';

describe('tenant boundary (row-level security)', () => {
  let db: DatabaseClients;
  let tenantA: string;
  let tenantB: string;
  let userInTenantA: string;

  beforeAll(async () => {
    db = createDatabaseClients({
      databaseUrl:
        process.env.DATABASE_URL ??
        'postgres://voai_app:voai-app-dev-password@localhost:5432/voai_dev',
      neo4jUri: process.env.NEO4J_URI ?? 'bolt://localhost:7687',
      neo4jUser: process.env.NEO4J_USER ?? 'neo4j',
      neo4jPassword: process.env.NEO4J_PASSWORD ?? 'voai-dev-password',
      redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
      objectStoreBucket: process.env.OBJECT_STORE_BUCKET ?? 'voai-dev',
      objectStoreEndpoint: process.env.OBJECT_STORE_ENDPOINT ?? 'http://localhost:9000',
      objectStoreAccessKeyId: process.env.OBJECT_STORE_ACCESS_KEY_ID ?? 'voai',
      objectStoreSecretAccessKey: process.env.OBJECT_STORE_SECRET_ACCESS_KEY ?? 'voai-dev-password',
    });

    // tenants has no RLS (it's the root table) — withTenant is still the
    // only access path by design, so seed it with a placeholder system
    // tenant id. The id passed here does not gate this particular insert.
    const tenantRows = await db.postgres.withTenant(SYSTEM_TENANT, (client) =>
      client.query<{ id: string }>(`insert into tenants (name) values ($1), ($2) returning id`, [
        'Integration Test Tenant A',
        'Integration Test Tenant B',
      ]),
    );
    [tenantA, tenantB] = tenantRows.rows.map((r) => r.id) as [string, string];

    const userRows = await db.postgres.withTenant(tenantA, (client) =>
      client.query<{ id: string }>(
        `insert into users (tenant_id, email, user_type) values ($1, $2, 'founder') returning id`,
        [tenantA, `founder-${randomUUID()}@example.com`],
      ),
    );
    userInTenantA = userRows.rows[0]?.id as string;
  });

  afterAll(async () => {
    await db.close();
  });

  it('tenant A can read its own user', async () => {
    const result = await db.postgres.withTenant(tenantA, (client) =>
      client.query<{ id: string }>('select id from users where id = $1', [userInTenantA]),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.id).toBe(userInTenantA);
  });

  it("tenant B cannot read tenant A's user — RLS returns zero rows, not an error", async () => {
    const result = await db.postgres.withTenant(tenantB, (client) =>
      client.query<{ id: string }>('select id from users where id = $1', [userInTenantA]),
    );
    expect(result.rows).toHaveLength(0);
  });

  it("tenant B cannot read tenant A's user via an unfiltered scan either", async () => {
    const result = await db.postgres.withTenant(tenantB, (client) =>
      client.query<{ id: string }>('select id from users'),
    );
    expect(result.rows.find((r) => r.id === userInTenantA)).toBeUndefined();
  });
});
