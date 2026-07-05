/**
 * Plan entitlement limits and enforcement.
 *
 * Each plan tier has hard limits on:
 *   - roster_calls_per_month: AI agent roster invocations
 *   - expert_sessions_per_month: booked expert video sessions
 *   - seats: number of active users per tenant
 *
 * checkEntitlement() reads the tenant's current usage for the billing period
 * and throws a PlatformError (429 QUOTA_EXCEEDED) if the limit is reached.
 * It is intentionally fast — it queries only aggregates, not individual rows.
 */

import type { TenantContext } from '@voai/auth-context';
import type { TenantScopedClient } from '@voai/db';

export type PlanTier = 'starter' | 'growth' | 'enterprise';
export type EntitlementDimension = 'roster_calls_per_month' | 'expert_sessions_per_month' | 'seats';

interface PlanLimits {
  readonly roster_calls_per_month: number;
  readonly expert_sessions_per_month: number;
  readonly seats: number;
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  starter: {
    roster_calls_per_month: 100,
    expert_sessions_per_month: 2,
    seats: 3,
  },
  growth: {
    roster_calls_per_month: 1_000,
    expert_sessions_per_month: 20,
    seats: 10,
  },
  enterprise: {
    roster_calls_per_month: Infinity,
    expert_sessions_per_month: Infinity,
    seats: Infinity,
  },
};

export interface EntitlementStatus {
  readonly allowed: boolean;
  readonly current: number;
  readonly limit: number;
  readonly plan: PlanTier;
  readonly dimension: EntitlementDimension;
}

/**
 * Returns the current usage for a given dimension in the current calendar month.
 * Queries the metering_events table for token/call counts.
 */
export async function getMonthlyUsage(
  tc: TenantContext,
  client: TenantScopedClient,
  dimension: EntitlementDimension,
): Promise<number> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  if (dimension === 'roster_calls_per_month') {
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM metering_events
       WHERE tenant_id = $1
         AND event_type = 'ai_roster_call'
         AND recorded_at >= $2`,
      [tc.tenantId, monthStart.toISOString()],
    );
    return parseInt(result.rows[0]?.count ?? '0', 10);
  }

  if (dimension === 'expert_sessions_per_month') {
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM metering_events
       WHERE tenant_id = $1
         AND event_type = 'expert_minutes'
         AND recorded_at >= $2`,
      [tc.tenantId, monthStart.toISOString()],
    );
    return parseInt(result.rows[0]?.count ?? '0', 10);
  }

  // seats: count active users (not a metering_events query — use identity table)
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM identity_users
     WHERE tenant_id = $1 AND status = 'active'`,
    [tc.tenantId],
  );
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Reads tenant plan from the identity_tenants table and returns entitlement status.
 * Does NOT throw — callers decide whether to enforce.
 */
export async function checkEntitlement(
  tc: TenantContext,
  client: TenantScopedClient,
  dimension: EntitlementDimension,
): Promise<EntitlementStatus> {
  // Read the tenant's current plan
  const planResult = await client.query<{ plan: string }>(
    `SELECT plan FROM identity_tenants WHERE id = $1`,
    [tc.tenantId],
  );
  const plan = (planResult.rows[0]?.plan ?? 'starter') as PlanTier;
  const limits = PLAN_LIMITS[plan];
  const limit = limits[dimension];

  if (limit === Infinity) {
    return { allowed: true, current: 0, limit: Infinity, plan, dimension };
  }

  const current = await getMonthlyUsage(tc, client, dimension);
  return { allowed: current < limit, current, limit, plan, dimension };
}
