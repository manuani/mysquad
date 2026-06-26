/**
 * Identity and Tenancy Service
 *
 * Per System Architecture §3.1, §3.4.1, §3.5, and §8.1.1, Identity and
 * Tenancy is one component, not two (verification backlog Issue 1; see
 * docs/adr/008-merge-identity-and-tenancy.md).
 *
 * WorkOS-backed authentication (Apple, Google, Microsoft, email magic-link).
 * Issues session tokens that authenticate API calls and carry tenant
 * context. Owns the tenant model and enforces multi-tenant isolation: row-
 * level security in Postgres, and the boundary that makes cross-tenant
 * access unrepresentable through any API path (Sprint 1.2.2 boundary
 * tests).
 *
 * Sprint reference: Phase 1, Sprint 1.2 (Identity and authentication) and
 * Sprint 1.2.2 (Tenant model and enforcement).
 *
 * This module is a stub at the skeleton stage. It exposes the
 * ModuleDefinition contract so the API gateway can register it and CI can
 * verify the build. Real handlers, persistence, and tests are added in the
 * sprints above.
 */

import express from 'express';
import type { ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';

export const identityAndTenancyModule: ModuleDefinition = {
  name: 'identity-and-tenancy',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'identity-and-tenancy' });
    const router = express.Router();

    router.get('/healthz', (_req, res) => {
      res.json({ module: 'identity-and-tenancy', status: 'healthy' });
    });

    log.info('module registered');

    return {
      name: 'identity-and-tenancy',
      router,
      health: async () => ({ status: 'healthy' }),
      shutdown: async () => {
        log.info('module shutdown');
      },
    };
  },
};

export default identityAndTenancyModule;
