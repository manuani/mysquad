/**
 * Admin Console API routes. Mounted at `/v1/admin/...`.
 *
 * ALL routes are protected by x-admin-key authentication. The key is set via
 * ADMIN_API_KEY environment variable and checked before any route handler runs.
 * These endpoints are NOT tenant-scoped and must never be reachable from
 * founder-facing ingress rules.
 *
 * Endpoints:
 *   GET    /tenants                        — list all tenants with usage rollup
 *   POST   /tenants                        — provision a new tenant (ops onboarding)
 *   GET    /tenants/:id/usage              — detailed usage for a specific tenant
 *   GET    /tenants/:id/users              — list users in a tenant
 *   POST   /tenants/:id/users/invite       — invite a new user to a tenant
 *   PATCH  /tenants/:id/users/:uid/role    — change a user's role
 *   DELETE /tenants/:id/users/:uid         — deactivate a user (revokes sessions)
 *   GET    /health/services                — aggregate health of all registered modules
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { PostgresClient } from '@voai/db';
import type { Logger } from '@voai/types';
import { isPlatformError, NotFoundError, ValidationError } from '@voai/errors';
import { listAllTenants, provisionTenant } from './tenants.js';
import {
  listUsersInTenant,
  inviteUser,
  changeUserRole,
  deactivateUser,
  type UserRole,
} from './users.js';

const VALID_ROLES: UserRole[] = ['founder', 'admin', 'expert'];

function handleError(err: unknown, res: Response, log: Logger): void {
  if (isPlatformError(err)) {
    res.status(err.httpStatus).json({ error: err.code, message: err.message });
    return;
  }
  log.error('unexpected admin error', { err: String(err) });
  res.status(500).json({ error: 'INTERNAL', message: 'unexpected error' });
}

function requireAdminKey(adminKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.header('x-admin-key');
    if (!key || key !== adminKey) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'valid x-admin-key required' });
      return;
    }
    next();
  };
}

export function buildAdminRouter(postgres: PostgresClient, log: Logger, adminKey: string): Router {
  const router = Router();

  router.use(requireAdminKey(adminKey));

  router.get('/tenants', async (req: Request, res: Response) => {
    try {
      const q = req.query as Record<string, string>;
      const limit = q['limit'] ? parseInt(q['limit'], 10) : 50;
      const offset = q['offset'] ? parseInt(q['offset'], 10) : 0;
      const result = await listAllTenants(postgres, { limit, offset });
      res.status(200).json(result);
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.post('/tenants', async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      if (typeof body.name !== 'string' || !body.name.trim())
        throw new ValidationError('name required');
      if (typeof body.email !== 'string' || !body.email.trim())
        throw new ValidationError('email required');
      const result = await provisionTenant(postgres, {
        name: body.name as string,
        email: body.email as string,
        plan: typeof body.plan === 'string' ? body.plan : undefined,
      });
      log.info('tenant provisioned', { tenantId: result.tenantId, email: result.email });
      res.status(201).json(result);
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.get('/tenants/:id/usage', async (req: Request, res: Response) => {
    try {
      const id = req.params['id']!;
      const q = req.query as Record<string, string>;
      const from = q['from']
        ? new Date(q['from'])
        : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const to = q['to'] ? new Date(q['to']) : new Date();

      const rows = await postgres.adminQuery<Record<string, unknown>>(
        `SELECT
           event_type,
           SUM(quantity)         AS total_quantity,
           SUM(total_cost_micro) AS total_cost_micro,
           COUNT(*)              AS event_count
         FROM metering_events
         WHERE tenant_id = $1 AND recorded_at BETWEEN $2 AND $3
         GROUP BY event_type
         ORDER BY event_type`,
        [id, from.toISOString(), to.toISOString()],
      );

      res.status(200).json({
        tenantId: id,
        periodStart: from.toISOString(),
        periodEnd: to.toISOString(),
        breakdown: rows.map((r) => ({
          eventType: r['event_type'],
          totalQuantity: Number(r['total_quantity']),
          totalCostMicro: Number(r['total_cost_micro']),
          eventCount: Number(r['event_count']),
        })),
      });
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.get('/tenants/:id/users', async (req: Request, res: Response) => {
    try {
      const id = req.params['id']!;
      const q = req.query as Record<string, string>;
      const limit = q['limit'] ? parseInt(q['limit'], 10) : 50;
      const offset = q['offset'] ? parseInt(q['offset'], 10) : 0;
      const result = await listUsersInTenant(postgres, id, { limit, offset });
      res.status(200).json(result);
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.post('/tenants/:id/users/invite', async (req: Request, res: Response) => {
    try {
      const tenantId = req.params['id']!;
      const body = req.body as Record<string, unknown>;
      if (typeof body.email !== 'string' || !body.email.trim())
        throw new ValidationError('email required');
      if (!VALID_ROLES.includes(body.role as UserRole))
        throw new ValidationError(`role must be one of: ${VALID_ROLES.join(', ')}`);
      const result = await inviteUser(postgres, {
        tenantId,
        email: body.email as string,
        role: body.role as UserRole,
      });
      log.info('user invited', { tenantId, email: result.email, role: result.role });
      res.status(201).json(result);
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.patch('/tenants/:id/users/:uid/role', async (req: Request, res: Response) => {
    try {
      const tenantId = req.params['id']!;
      const userId = req.params['uid']!;
      const body = req.body as Record<string, unknown>;
      if (!VALID_ROLES.includes(body.role as UserRole))
        throw new ValidationError(`role must be one of: ${VALID_ROLES.join(', ')}`);
      const user = await changeUserRole(postgres, tenantId, userId, body.role as UserRole);
      if (!user) throw new NotFoundError('user not found in tenant');
      log.info('user role changed', { tenantId, userId, role: body.role });
      res.status(200).json(user);
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.delete('/tenants/:id/users/:uid', async (req: Request, res: Response) => {
    try {
      const tenantId = req.params['id']!;
      const userId = req.params['uid']!;
      const ok = await deactivateUser(postgres, tenantId, userId);
      if (!ok) throw new NotFoundError('user not found in tenant');
      log.info('user deactivated', { tenantId, userId });
      res.status(204).send();
    } catch (err) {
      handleError(err, res, log);
    }
  });

  return router;
}
