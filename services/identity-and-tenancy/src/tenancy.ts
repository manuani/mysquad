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
 * `TenantContext`.
 *
 * Two separate `withTenant` calls, not one: `users` has `FORCE ROW LEVEL
 * SECURITY` with a policy keyed on `tenant_id = current_setting('app.tenant_id')`,
 * and Postgres uses that same expression as the INSERT's implicit `WITH
 * CHECK` when none is given explicitly. Inserting the founder's row while
 * still scoped to `SYSTEM_TENANT` fails RLS, because the row's `tenant_id`
 * is the brand-new tenant, not `SYSTEM_TENANT` — `current_setting('app.tenant_id')`
 * has to equal the row's `tenant_id` at insert time, so the user insert
 * must run in a connection scoped to the tenant that was just created.
 * (Caught by exercising this endpoint end to end against the live stack —
 * the unit tests mock `PostgresClient` and don't exercise real RLS.)
 */
export async function createTenantWithFounder(
  postgres: PostgresClient,
  tenantName: string,
  email: string,
): Promise<{ tenant: TenantRow; user: UserRow }> {
  const tenant = await postgres.withTenant(SYSTEM_TENANT, async (client) => {
    const tenantResult = await client.query<TenantSqlRow>(
      'insert into tenants (name) values ($1) returning id, name, created_at',
      [tenantName],
    );
    const tenantRow = tenantResult.rows[0];
    if (!tenantRow) {
      throw new Error('failed to create tenant');
    }
    return toTenant(tenantRow);
  });

  const user = await postgres.withTenant(tenant.id, async (client) => {
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
    return toUser(userRow);
  });

  // `email_tenant_index` has no RLS (same exception as `tenants`) — it
  // exists purely so `findUserByEmailAcrossTenants` can discover which
  // tenant to scope into, before it's allowed to see anything in `users`.
  // Without this, a real cross-tenant email lookup is structurally
  // impossible: RLS would hide the row no matter which tenant you guess.
  await postgres.withTenant(SYSTEM_TENANT, async (client) => {
    await client.query('insert into email_tenant_index (email, tenant_id) values ($1, $2)', [
      email,
      tenant.id,
    ]);
  });

  return { tenant, user };
}

/**
 * Finds a user by email across all tenants. Used at sign-in time, before
 * the caller knows which tenant the email belongs to.
 *
 * Two-step lookup, not one: first resolve `tenant_id` from
 * `email_tenant_index` (no RLS — it only maps email -> tenant_id, nothing
 * else), then re-query `users` scoped to that real tenant_id so RLS
 * actually allows the row through. A single query scoped to `SYSTEM_TENANT`
 * would have RLS silently hide every row belonging to a real tenant —
 * confirmed broken by exercising sign-in end to end against the live
 * stack; the unit tests mock `PostgresClient` and don't exercise RLS.
 */
export async function findUserByEmailAcrossTenants(
  postgres: PostgresClient,
  email: string,
): Promise<{ tenant: TenantRow; user: UserRow } | null> {
  const indexRow = await postgres.withTenant(SYSTEM_TENANT, async (client) => {
    const result = await client.query<{ tenant_id: string }>(
      'select tenant_id from email_tenant_index where email = $1',
      [email],
    );
    return result.rows[0] ?? null;
  });
  if (!indexRow) return null;

  return postgres.withTenant(indexRow.tenant_id, async (client) => {
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
 * GDPR "right to erasure" — permanently deletes all data belonging to the
 * tenant. Order matters: child rows (RLS-protected) must go before the
 * parent `tenants` row (which anchors the RLS setting).
 *
 * Tables not touched here (brain_items, sessions, ledger rows, etc.) are
 * owned by other services that also have RLS — those rows will be
 * unreachable once the tenant row and auth_sessions are gone. A follow-up
 * cross-service cascade job (deferred) can hard-delete them on a cron.
 */
export async function deleteTenantData(
  tenantContext: TenantContext,
  postgres: PostgresClient,
): Promise<void> {
  const { tenantId } = tenantContext;

  // Delete RLS-protected tables while scoped to the tenant
  await postgres.withTenant(tenantId, async (client) => {
    await client.query('DELETE FROM auth_sessions WHERE tenant_id = $1', [tenantId]);
    await client.query('DELETE FROM metering_events WHERE tenant_id = $1', [tenantId]);
    await client.query('DELETE FROM monthly_usage_rollup WHERE tenant_id = $1', [tenantId]);
    await client.query('DELETE FROM identity_tenants WHERE id = $1', [tenantId]);
    await client.query('DELETE FROM users WHERE tenant_id = $1', [tenantId]);
    await client.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
  });

  // email_tenant_index has no RLS — clean it up under SYSTEM_TENANT
  await postgres.withTenant(SYSTEM_TENANT, async (client) => {
    await client.query('DELETE FROM email_tenant_index WHERE tenant_id = $1', [tenantId]);
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
    const result = await client.query<UserSqlRow>(
      'select id, tenant_id, email, user_type, created_at from users where id = $1',
      [tenantContext.userId],
    );
    const row = result.rows[0];
    return row ? toUser(row) : null;
  });
}
