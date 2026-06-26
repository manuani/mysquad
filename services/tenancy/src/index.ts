/**
 * Tenancy Service
 *
 * Tenant model and multi-tenant isolation. Enforces row-level security in Postgres and propagates tenant context to every downstream call. Boundary tests in Sprint 1.2.2 verify cross-tenant access is blocked at all layers.
 *
 * Sprint reference: Phase 1, Sprint 1.2.2 — Tenant model and enforcement
 *
 * This module is a stub at the skeleton stage. It exposes the ModuleDefinition
 * contract so the API gateway can register it and CI can verify the build.
 * Real handlers, persistence, and tests are added in the sprint above.
 */

import express from 'express';
import type { ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';

export const tenancyModule: ModuleDefinition = {
  name: 'tenancy',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'tenancy' });
    const router = express.Router();

    router.get('/healthz', (_req, res) => {
      res.json({ module: 'tenancy', status: 'healthy' });
    });

    log.info('module registered');

    return {
      name: 'tenancy',
      router,
      health: async () => ({ status: 'healthy' }),
      shutdown: async () => {
        log.info('module shutdown');
      },
    };
  },
};

export default tenancyModule;
