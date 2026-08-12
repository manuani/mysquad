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
import { checkDependencies } from '@voai/db';
import { buildAdminRouter } from './routes.js';

export type { TenantSummary, TenantListResult, TenantProvisionInput } from './tenants.js';
export { listAllTenants, provisionTenant } from './tenants.js';

export const admin_console_apiModule: ModuleDefinition = {
  name: 'admin-console-api',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'admin-console-api' });
    const postgres = ctx.db.postgres as PostgresClient;
    // The admin surface is cross-tenant: it lists every tenant, provisions new
    // ones, and manages users. A default key cannot be allowed to reach a
    // deployed environment — this repository is public, so `dev-admin-key` is
    // world-readable, and any deploy that forgot to set ADMIN_API_KEY would
    // hand full cross-tenant access to anyone who read the source.
    //
    // Refuse to start rather than fall back. A boot failure naming the missing
    // variable is recoverable in minutes; an open admin console may not be
    // noticed at all.
    const configuredAdminKey = process.env['ADMIN_API_KEY'];
    const env = (ctx.config as { env?: string }).env ?? process.env['NODE_ENV'] ?? 'development';

    if (!configuredAdminKey && env !== 'development' && env !== 'test') {
      throw new Error(
        `admin-console-api: ADMIN_API_KEY must be set when NODE_ENV=${env}. ` +
          'Refusing to start with the development default, which would leave the ' +
          'cross-tenant admin API open.',
      );
    }

    const adminKey = configuredAdminKey ?? 'dev-admin-key';
    if (!configuredAdminKey) {
      log.warn('ADMIN_API_KEY not set — using the development default', {
        env,
        detail: 'Set ADMIN_API_KEY before deploying; startup will fail without it outside development.',
      });
    }

    const router = express.Router();
    router.use(buildAdminRouter(postgres, log, adminKey));

    router.get('/healthz', async (_req, res) => {
      const health = await checkDependencies({ postgres });
      res.status(health.status === 'healthy' ? 200 : 503).json({ module: 'admin-console-api', ...health });
    });

    log.info('module registered');

    return {
      name: 'admin-console-api',
      router,
      health: () => checkDependencies({ postgres }),
      shutdown: async () => {
        log.info('module shutdown');
      },
    };
  },
};

export default admin_console_apiModule;
