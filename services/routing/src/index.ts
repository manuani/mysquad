/**
 * Routing Service
 *
 * All LLM calls dispatch through here. v1 baseline: single provider (Anthropic). Phase 5 expands to four-tier classification (Advanced/High/Good/OpenSource) across 5-7 providers with subscription-tier-driven routing and failover.
 *
 * Sprint reference: Phase 2, Sprint 2.1.2; Phase 5, Sprint 5.1
 *
 * This module is a stub at the skeleton stage. It exposes the ModuleDefinition
 * contract so the API gateway can register it and CI can verify the build.
 * Real handlers, persistence, and tests are added in the sprint above.
 */

import express from 'express';
import type { ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';

export const routingModule: ModuleDefinition = {
  name: 'routing',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'routing' });
    const router = express.Router();

    router.get('/healthz', (_req, res) => {
      res.json({ module: 'routing', status: 'healthy' });
    });

    log.info('module registered');

    return {
      name: 'routing',
      router,
      health: async () => ({ status: 'healthy' }),
      shutdown: async () => {
        log.info('module shutdown');
      },
    };
  },
};

export default routingModule;
