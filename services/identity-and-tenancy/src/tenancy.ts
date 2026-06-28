/**
 * Tenant and user persistence.
 *
 * Every function here that touches tenant data takes `tenantContext` (or,
 * for the pre-authentication creation path, a raw tenant id) as its first
 * parameter and goes through `db.postgres.withTenant` — never a raw query.
 * Per ADR 007 there is no ambient context to fall back to.
 *
 * `tenants` has no row-level security (it is the root table everything
 * else hangs off — see packages/db/tests/integration/tenant-boundary.test.ts
 * for the same pattern), but `withTenant` is still the only access path by
 * design, matching how the baseline integration test seeds it.
 */

import type { TenantContext } from '@voai/auth-context';
import type { PostgresClient } from '@voai/db';

export const SYSTEM_TENANT = '00000000-0000-0000-0000-000000000000';

export interface TenantRow {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
}

export interface UserRow {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly userType: 'founder' | 'admin' | 'expert';
  readonly createdAt: string;
}

interface TenantSqlRow {
  id: string;
  name: string;
  created_at: string;
}

interface UserSqlRow {
  id: string;
  tenant_id: string;
  email: string;
  user_type: 'founder' | 'admin' | 'expert';
  created_at: string;
}

function toTenant(row: TenantSqlRow): TenantRow {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

function toUser(row: UserSqlRow): UserRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    userType: row.user_type,
    createdAt: row.created_at,
  };
}

/**
 * Creates a new tenant plus its first user (the founder who signed up).
 * Called once per sign-up, before any `TenantContext` exists for the
 * caller — that's why this takes a tenant name/email rather than a
 * `TenantContext`. Uses `SYSTEM_TENANT` to satisfy `withTenant`'s
 * signature; it does not gate this insert, matching the integration test's
 * seeding pattern for the root table.
 */
export async function createTenantWithFounder(
  postgres: PostgresClient,
  tenantName: string,
  email: string,
): Promise<{ tenant: TenantRow; user: UserRow }> {
  return postgres.withTenant(SYSTEM_TENANT, async (client) => {
    const tenantResult = await client.query<TenantSqlRow>(
      'insert into tenants (name) values ($1) returning id, name, created_at',
      [tenantName],
    );
    const tenantRow = tenantResult.rows[0];
    if (!tenantRow) {
      throw new Error('failed to create tenant');
    }
    const tenant = toTenant(tenantRow);

    const userResult = await client.query<UserSqlRow>(
      `insert into users (tenant_id, email, user_type)
       values ($1, $2, 'founder')
       returning id, tenant_id, email, user_type, created_at`,
      [tenant.id, email],
    );
    const userRow = userResult.rows[0];
    if (!userRow) {
      throw new Error('failed to create founder user');
    }
    return { tenant, user: toUser(userRow) };
  });
}

/**
 * Finds a user by email across all tenants. Used at sign-in time, before
 * the caller knows which tenant the email belongs to — this is the one
 * place this module looks up a user without an existing `TenantContext`,
 * which is why it scans via `SYSTEM_TENANT` rather than a real tenant id.
 * RLS does not gate this query path because `users` policies key on
 * `tenant_id = current_setting('app.tenant_id')`, and the seed/lookup here
 * deliberately needs to search before that's known; this mirrors how a
 * real WorkOS callback resolves identity before tenant scope is known.
 */
export async function findUserByEmailAcrossTenants(
  postgres: PostgresClient,
  email: string,
): Promise<{ tenant: TenantRow; user: UserRow } | null> {
  return postgres.withTenant(SYSTEM_TENANT, async (client) => {
    const userResult = await client.query<UserSqlRow>(
      'select id, tenant_id, email, user_type, created_at from users where email = $1',
      [email],
    );
    const userRow = userResult.rows[0];
    if (!userRow) return null;

    const tenantResult = await client.query<TenantSqlRow>(
      'select id, name, created_at from tenants where id = $1',
      [userRow.tenant_id],
    );
    const tenantRow = tenantResult.rows[0];
    if (!tenantRow) return null;

    return { tenant: toTenant(tenantRow), user: toUser(userRow) };
  });
}

/**
 * Looks up the user this `TenantContext` was built for. Demonstrates the
 * normal post-authentication access pattern: `tenantContext` first,
 * `withTenant(tenantContext.tenantId, ...)`, RLS enforces the rest.
 */
export async function getUserInTenant(
  tenantContext: TenantContext,
  postgres: PostgresClient,
): Promise<UserRow | null> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const result = await client.query<UserSqlRow>('select id, tenant_id, email, user_type, created_at from users where id = $1', [
      tenantContext.userId,
    ]);
    const row = result.rows[0];
    return row ? toUser(row) : null;
  });
}
