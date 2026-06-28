/**
 * HTTP routes for the agent-runtime module. Mounted by the gateway at
 * `/v1/agent-runtime/...` (module mount-path convention, see root
 * CLAUDE.md "Conventions").
 *
 * Per ADR 007, the only place a `TenantContext` is constructed from a raw
 * request is here — everything past that point (agent-runtime.ts) receives
 * it as an explicit parameter. This module does not implement
 * authentication itself; it expects the gateway (or, in this skeleton
 * stage, the caller) to supply tenant/user identity via headers, matching
 * the dev-mode pattern used by `services/brain/src/routes.ts` until a real
 * session-token-to-context bridge is wired in front of every module.
 */

import { Router, type Request, type Response } from 'express';
import { buildTenantContext, type TenantContext } from '@voai/auth-context';
import { isPlatformError, ValidationError } from '@voai/errors';
import type { RoutingService } from '@voai/routing';
import type { Logger } from '@voai/types';
import { AgentRuntime } from './agent-runtime.js';
import { SARAH_CFO_PERSONA } from './personas/sarah-cfo.js';

/**
 * Builds a `TenantContext` from request headers, mirroring
 * `services/brain/src/routes.ts`'s `tenantContextFromRequest`. Header names
 * mirror the `TenantContext` fields exactly: `x-tenant-id`, `x-user-id`,
 * `x-user-type`, `x-session-id`.
 */
function tenantContextFromRequest(req: Request): TenantContext {
  return buildTenantContext({
    tenantId: req.header('x-tenant-id'),
    userId: req.header('x-user-id'),
    userType: req.header('x-user-type'),
    sessionId: req.header('x-session-id'),
  });
}

function handleError(err: unknown, res: Response, log: Logger): void {
  if (isPlatformError(err)) {
    res.status(err.httpStatus).json({ error: err.code, message: err.message, details: err.details });
    return;
  }
  // A prior bug in this repo was a silent catch block with no log line,
  // which is exactly how the bug stayed invisible until live-stack
  // exercise found it. Always log unexpected errors here.
  log.error('unexpected error in agent-runtime route', { err: String(err) });
  res.status(500).json({ error: 'INTERNAL', message: 'unexpected error' });
}

export function buildAgentRuntimeRouter(routingService: RoutingService, log: Logger): Router {
  const router = Router();
  const runtime = new AgentRuntime(routingService);

  router.post('/contributions', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromRequest(req);
      const body = req.body as { message?: unknown };
      if (typeof body.message !== 'string' || body.message.trim().length === 0) {
        throw new ValidationError('message is required');
      }

      const contribution = await runtime.generateContribution(tenantContext, SARAH_CFO_PERSONA, {
        message: body.message,
      });

      res.status(200).json(contribution);
    } catch (err) {
      handleError(err, res, log);
    }
  });

  return router;
}
