/**
 * Performance Service
 *
 * Captures the six performance signals per contribution (factual grounding, peer agreement, expert agreement, founder action, outcome, pushback). Drives the weekly evaluation cycle.
 *
 * Sprint reference: Phase 5, Sprint 5.3
 *
 * This module is a stub at the skeleton stage. It exposes the ModuleDefinition
 * contract so the API gateway can register it and CI can verify the build.
 * Real handlers, persistence, and tests are added in the sprint above.
 */

import express from 'express';
import type { ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';

export const performanceModule: ModuleDefinition = {
  name: 'performance',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'performance' });
    const router = express.Router();

    router.get('/healthz', (_req, res) => {
      res.json({ module: 'performance', status: 'healthy' });
    });

    log.info('module registered');

    return {
      name: 'performance',
      router,
      health: async () => ({ status: 'healthy' }),
      shutdown: async () => {
        log.info('module shutdown');
      },
    };
  },
};

export default performanceModule;
