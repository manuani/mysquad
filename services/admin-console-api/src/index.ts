/**
 * Admin Console API
 *
 * Operations team endpoints: tenant provisioning, usage dashboards,
 * user management. Protected by x-admin-key — NOT on the founder-facing
 * API surface.
 *
 * Sprint 12 implementation: tenant list, tenant provisioning, per-tenant
 * usage breakdown. Admin key is required on every request.
 */

import express from 'express';
import type { ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';
import type { PostgresClient } from '@voai/db';
import { buildAdminRouter } from './routes.js';

export type { TenantSummary, TenantListResult, TenantProvisionInput } from './tenants.js';
export { listAllTenants, provisionTenant } from './tenants.js';

export const admin_console_apiModule: ModuleDefinition = {
  name: 'admin-console-api',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'admin-console-api' });
    const postgres = ctx.db.postgres as PostgresClient;
    const adminKey = process.env['ADMIN_API_KEY'] ?? 'dev-admin-key';

    const router = express.Router();
    router.use(buildAdminRouter(postgres, log, adminKey));

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
