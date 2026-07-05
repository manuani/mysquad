import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { PostgresClient } from '@voai/db';
import type { AuditActorType } from './audit.js';
import { recordAuditEvent } from './audit.js';

// Methods that change state — GET/HEAD/OPTIONS are excluded
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Express middleware that writes an audit_log row after every mutating
 * request finishes. Attach to the router after authentication so that
 * tenant/user context headers are available.
 *
 * Usage:
 *   router.use(auditMiddleware(postgres));
 */
export function auditMiddleware(postgres: PostgresClient): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!MUTATING_METHODS.has(req.method)) {
      next();
      return;
    }

    res.on('finish', () => {
      const tenantId = req.header('x-tenant-id');
      const actorId = req.header('x-user-id');
      const userType = req.header('x-user-type') as AuditActorType | undefined;
      const outcome = res.statusCode < 400 ? 'success' : 'failure';

      const requestId =
        (res.locals['requestId'] as string | undefined) ?? res.getHeader('x-request-id');

      void recordAuditEvent(postgres, {
        tenantId,
        actorId,
        actorType: userType,
        action: `${req.method} ${req.path}`,
        outcome,
        ipAddress: req.ip,
        userAgent: req.header('user-agent'),
        payload: { statusCode: res.statusCode, requestId },
      });
    });

    next();
  };
}
