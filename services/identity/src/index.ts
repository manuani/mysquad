/**
 * Identity Service
 *
 * WorkOS-backed authentication. Apple, Google, Microsoft, and email magic-link sign-in flows. Issues session tokens that authenticate API calls and carry tenant context.
 *
 * Sprint reference: Phase 1, Sprint 1.2 — Identity and authentication
 *
 * This module is a stub at the skeleton stage. It exposes the ModuleDefinition
 * contract so the API gateway can register it and CI can verify the build.
 * Real handlers, persistence, and tests are added in the sprint above.
 */

import express from 'express';
import type { ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';

export const identityModule: ModuleDefinition = {
  name: 'identity',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'identity' });
    const router = express.Router();

    router.get('/healthz', (_req, res) => {
      res.json({ module: 'identity', status: 'healthy' });
    });

    log.info('module registered');

    return {
      name: 'identity',
      router,
      health: async () => ({ status: 'healthy' }),
      shutdown: async () => {
        log.info('module shutdown');
      },
    };
  },
};

export default identityModule;
