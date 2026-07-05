/**
 * Marketplace Metering Service
 *
 * Meters billable usage events (LLM tokens, expert session minutes, roster
 * calls) and integrates with Stripe for subscription billing and per-session
 * charges. Gracefully degrades when STRIPE_SECRET_KEY is absent.
 *
 * Sprint 11 implementation: metering events, usage summary, Stripe customer /
 * subscription / expert-session-charge endpoints.
 */

import express from 'express';
import type { ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';
import type { PostgresClient } from '@voai/db';
import { buildMeteringRouter } from './routes.js';

export type {
  MeteringEvent,
  RecordMeteringEventInput,
  MeteringEventType,
  UsageSummary,
} from './metering.js';
export { recordMeteringEvent, getTenantUsageSummary, estimateCostMicro } from './metering.js';

export type { BillingClient, SubscriptionTier } from './stripe.js';
export { createBillingClient } from './stripe.js';

export const marketplace_meteringModule: ModuleDefinition = {
  name: 'marketplace-metering',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'marketplace-metering' });
    const postgres = ctx.db.postgres as PostgresClient;

    const router = express.Router();
    router.use(buildMeteringRouter(postgres, log));

    router.get('/healthz', (_req, res) => {
      res.json({ module: 'marketplace-metering', status: 'healthy' });
    });

    log.info('module registered');

    return {
      name: 'marketplace-metering',
      router,
      health: async () => ({ status: 'healthy' }),
      shutdown: async () => {
        log.info('module shutdown');
      },
    };
  },
};

export default marketplace_meteringModule;
