/**
 * Admin Console API
 *
 * Operations team endpoints serving the Admin Console web app. Three role groups (Operations, Customer Success, Trust & Safety). Audit logging on every action. Consent-gated founder support access.
 *
 * Sprint reference: Phase 7, Sprints 7.1-7.3; System Architecture v2 §6
 *
 * This module is a stub at the skeleton stage. It exposes the ModuleDefinition
 * contract so the API gateway can register it and CI can verify the build.
 * Real handlers, persistence, and tests are added in the sprint above.
 */

import express from 'express';
import type { ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';

export const admin_console_apiModule: ModuleDefinition = {
  name: 'admin-console-api',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'admin-console-api' });
    const router = express.Router();

    router.get('/healthz', (_req, res) => {
      res.json({ module: 'admin-console-api', status: 'healthy' });
    });

    log.info('module registered');

    return {
      name: 'admin-console-api',
      router,
      health: async () => ({ status: 'healthy' }),
      shutdown: async () => {
        log.info('module shutdown');
      },
    };
  },
};

export default admin_console_apiModule;
