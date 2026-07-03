/**
 * Admin tenant management.
 *
 * Reads from identity_tenants and usage rollup tables to provide the
 * operations team with a view of all tenants, their subscription status,
 * and usage metrics.
 *
 * These are ADMIN-only endpoints — they are NOT tenant-scoped by RLS.
 * The admin-console-api module is protected by x-admin-key middleware
 * at the router level and never exposed to founder-facing traffic.
 */

import type { PostgresClient } from '@voai/db';

export interface TenantSummary {
  readonly tenantId: string;
  readonly name: string;
  readonly email: string;
  readonly plan: string;
  readonly status: string;
  readonly createdAt: string;
  readonly totalCostMicroThisMonth: number;
  readonly totalRosterCallsThisMonth: number;
}

export interface TenantListResult {
  readonly tenants: TenantSummary[];
  readonly total: number;
}

/**
 * Returns all tenants with their current-month usage roll-up.
 * Uses a LEFT JOIN so tenants with zero usage this month still appear.
 */
export async function listAllTenants(
  postgres: PostgresClient,
  opts: { limit?: number; offset?: number } = {},
): Promise<TenantListResult> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const now = new Date();

  // voai_admin bypasses RLS — this query reads across all tenants.
  // The admin-console-api is the only module that calls postgres directly
  // without withTenant(); it uses a separate admin connection pool.
  const rows = await postgres.adminQuery<Record<string, unknown>>(
    `SELECT
       it.id AS tenant_id,
       it.name,
       it.email,
       COALESCE(it.plan, 'starter') AS plan,
       COALESCE(it.status, 'active') AS status,
       it.created_at,
       COALESCE(mur.total_cost_micro, 0)      AS total_cost_micro_this_month,
       COALESCE(mur.total_roster_calls, 0)    AS total_roster_calls_this_month
     FROM identity_tenants it
     LEFT JOIN monthly_usage_rollup mur
       ON mur.tenant_id = it.id
       AND mur.period_year  = $1
       AND mur.period_month = $2
     ORDER BY it.created_at DESC
     LIMIT $3 OFFSET $4`,
    [now.getFullYear(), now.getMonth() + 1, limit, offset],
  );

  const countRows = await postgres.adminQuery<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM identity_tenants',
    [],
  );

  return {
    tenants: rows.map((row) => ({
      tenantId: row['tenant_id'] as string,
      name: row['name'] as string,
      email: row['email'] as string,
      plan: row['plan'] as string,
      status: row['status'] as string,
      createdAt: (row['created_at'] as Date).toISOString(),
      totalCostMicroThisMonth: Number(row['total_cost_micro_this_month'] ?? 0),
      totalRosterCallsThisMonth: Number(row['total_roster_calls_this_month'] ?? 0),
    })),
    total: parseInt(countRows[0]?.['count'] ?? '0', 10),
  };
}

export interface TenantProvisionInput {
  readonly name: string;
  readonly email: string;
  readonly plan?: string;
}

/**
 * Directly provisions a tenant (bypasses the founder sign-up flow).
 * Used by the operations team to onboard enterprise customers.
 */
export async function provisionTenant(
  postgres: PostgresClient,
  input: TenantProvisionInput,
): Promise<{ tenantId: string; email: string; plan: string }> {
  const rows = await postgres.adminQuery<Record<string, unknown>>(
    `INSERT INTO identity_tenants (name, email, plan, status)
     VALUES ($1, $2, $3, 'active')
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, plan = EXCLUDED.plan
     RETURNING id, email, COALESCE(plan, 'starter') AS plan`,
    [input.name, input.email.toLowerCase(), input.plan ?? 'starter'],
  );
  const row = rows[0]!;
  return {
    tenantId: row['id'] as string,
    email: row['email'] as string,
    plan: row['plan'] as string,
  };
}
