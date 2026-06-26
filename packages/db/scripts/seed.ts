/**
 * Seeds a test tenant and test user, then confirms row-level security
 * blocks cross-tenant reads — the same property
 * `tests/integration/tenant-boundary.test.ts` asserts, run here as a
 * standalone script per Deliverable 1.1.2's stated verification step
 * ("pnpm run db:seed produces a working test tenant").
 *
 * Run after the Docker Compose stack is up and migrations are applied:
 *   docker compose -f infra/docker/docker-compose.yml up -d
 *   pnpm run db:migrate
 *   pnpm run db:seed
 */

import { createDatabaseClients } from '../src/index.js';

const SYSTEM_TENANT = '00000000-0000-0000-0000-000000000000';

async function main(): Promise<void> {
  const db = createDatabaseClients({
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

  try {
    const tenantResult = await db.postgres.withTenant(SYSTEM_TENANT, (client) =>
      client.query<{ id: string }>(`insert into tenants (name) values ($1) returning id`, [
        'Dev Test Tenant',
      ]),
    );
    const tenantId = tenantResult.rows[0]?.id;
    if (!tenantId) throw new Error('tenant insert returned no id');
    console.log(`Created test tenant: ${tenantId}`);

    const userResult = await db.postgres.withTenant(tenantId, (client) =>
      client.query<{ id: string }>(
        `insert into users (tenant_id, email, user_type) values ($1, $2, 'founder') returning id`,
        [tenantId, 'founder@dev-test-tenant.example.com'],
      ),
    );
    const userId = userResult.rows[0]?.id;
    console.log(`Created test user: ${userId}`);

    const otherTenantResult = await db.postgres.withTenant(SYSTEM_TENANT, (client) =>
      client.query<{ id: string }>(`insert into tenants (name) values ($1) returning id`, [
        'Dev Test Tenant — Boundary Check',
      ]),
    );
    const otherTenantId = otherTenantResult.rows[0]?.id;
    if (!otherTenantId) throw new Error('boundary-check tenant insert returned no id');

    const crossTenantRead = await db.postgres.withTenant(otherTenantId, (client) =>
      client.query<{ id: string }>('select id from users where id = $1', [userId]),
    );

    if (crossTenantRead.rows.length === 0) {
      console.log('Row-level security verified: cross-tenant read returned zero rows.');
    } else {
      throw new Error(
        'TENANT BOUNDARY VIOLATION: cross-tenant read returned a row. RLS is not enforcing isolation.',
      );
    }

    console.log('\nSeed complete.');
    console.log(`  Test tenant:        ${tenantId}`);
    console.log(`  Test user:          ${userId}`);
    console.log(`  Boundary-check tenant: ${otherTenantId} (confirmed cannot read the user above)`);
  } finally {
    await db.close();
  }
}

main().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exitCode = 1;
});
