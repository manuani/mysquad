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
 * Real handlers and persistence land in this session (Deliverables 1.2.1
 * and 1.2.2), built against a `DevAuthProvider` because no real WorkOS
 * account is available in this environment — see `dev-auth-provider.ts`
 * for what's deferred to the session that has WorkOS credentials.
 */

import type { ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';
import type { PostgresClient } from '@voai/db';
import { DevAuthProvider } from './dev-auth-provider.js';
import { buildIdentityAndTenancyRouter } from './routes.js';

export type { AuthProvider, AuthResult, ProviderIdentity, SignInMethod } from './auth-provider.js';
export { DevAuthProvider } from './dev-auth-provider.js';
export {
  createTenantWithFounder,
  findUserByEmailAcrossTenants,
  getUserInTenant,
  SYSTEM_TENANT,
  type TenantRow,
  type UserRow,
} from './tenancy.js';

export const identityAndTenancyModule: ModuleDefinition = {
  name: 'identity-and-tenancy',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'identity-and-tenancy' });

    // ctx.db.postgres is typed as `unknown` in @voai/types (module.ts
    // intentionally keeps DatabaseClients loosely typed there to avoid a
    // circular dependency on @voai/db); narrow it to the concrete
    // PostgresClient contract this module compiles against.
    const postgres = ctx.db.postgres as PostgresClient;
    const authProvider = new DevAuthProvider(postgres);

    const router = buildIdentityAndTenancyRouter(authProvider, log);

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
