/**
 * Resolves a tenant's subscription plan for routing.
 *
 * `RoutingService.complete` takes a plan tier that decides which model tiers a
 * tenant may reach, and it defaults to `'starter'`. Nothing ever passed it, so
 * every tenant — enterprise included — was dispatched at the `good` tier, and
 * the `advanced` and `high` providers registered at boot were unreachable.
 * Enterprise tenants paid enterprise rates for the cheapest model.
 *
 * The plan lives on `tenants.plan` (migration 0010), the same column
 * marketplace-metering reads for entitlements.
 */

import type { PostgresClient } from '@voai/db';
import type { TenantContext } from '@voai/auth-context';
import type { Logger } from '@voai/types';
import type { PlanTier } from '@voai/routing';

const VALID: readonly PlanTier[] = ['starter', 'growth', 'enterprise'];

/**
 * Plans change on billing events, not between messages, so a short TTL keeps a
 * roster call from issuing one lookup per persona while still picking up an
 * upgrade within the same session.
 */
const TTL_MS = 60_000;

interface CacheEntry {
  readonly plan: PlanTier;
  readonly at: number;
}

export interface PlanResolver {
  (tenantContext: TenantContext): Promise<PlanTier>;
}

export function createPlanResolver(
  postgres: PostgresClient,
  log: Logger,
  now: () => number = Date.now,
): PlanResolver {
  const cache = new Map<string, CacheEntry>();

  return async function resolvePlan(tenantContext: TenantContext): Promise<PlanTier> {
    const cached = cache.get(tenantContext.tenantId);
    if (cached && now() - cached.at < TTL_MS) return cached.plan;

    try {
      const rows = await postgres.withTenant(tenantContext.tenantId, async (client) => {
        const result = await client.query<{ plan: string }>(
          'SELECT plan FROM tenants WHERE id = $1',
          [tenantContext.tenantId],
        );
        return result.rows;
      });

      const value = rows[0]?.plan;
      const plan = VALID.includes(value as PlanTier) ? (value as PlanTier) : 'starter';
      cache.set(tenantContext.tenantId, { plan, at: now() });
      return plan;
    } catch (err) {
      // Never fail a founder's request over a plan lookup. Falling back to
      // 'starter' degrades model quality rather than returning an error, and
      // errs toward the cheaper tier rather than billing for one they may not
      // hold.
      log.warn('plan lookup failed, defaulting to starter', {
        tenantId: tenantContext.tenantId,
        err: String(err),
      });
      return 'starter';
    }
  };
}
