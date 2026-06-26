/**
 * Marketplace Metering Service
 *
 * Sub-component of Marketplace. Emits meter events for the four billing models (per-month, per-use, per-token, per-day). Aggregates per founder per agent per billing period. Stripe metered billing for invoicing.
 *
 * Sprint reference: Phase 6, Sprint 6.1; System Architecture v2 §2.2
 *
 * This module is a stub at the skeleton stage. It exposes the ModuleDefinition
 * contract so the API gateway can register it and CI can verify the build.
 * Real handlers, persistence, and tests are added in the sprint above.
 */

import express from 'express';
import type { ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';

export const marketplace_meteringModule: ModuleDefinition = {
  name: 'marketplace-metering',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'marketplace-metering' });
    const router = express.Router();

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
