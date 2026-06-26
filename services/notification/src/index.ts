/**
 * Notification Service
 *
 * Morning briefings, alerts, email/push delivery, hand-raise notifications. Scheduled (briefings) and event-driven (alerts on risk/decision/conflict surfacing).
 *
 * Sprint reference: Phase 4 onwards
 *
 * This module is a stub at the skeleton stage. It exposes the ModuleDefinition
 * contract so the API gateway can register it and CI can verify the build.
 * Real handlers, persistence, and tests are added in the sprint above.
 */

import express from 'express';
import type { ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';

export const notificationModule: ModuleDefinition = {
  name: 'notification',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'notification' });
    const router = express.Router();

    router.get('/healthz', (_req, res) => {
      res.json({ module: 'notification', status: 'healthy' });
    });

    log.info('module registered');

    return {
      name: 'notification',
      router,
      health: async () => ({ status: 'healthy' }),
      shutdown: async () => {
        log.info('module shutdown');
      },
    };
  },
};

export default notificationModule;
