/**
 * HTTP routes for the routing module. Mounted by the gateway at
 * `/v1/routing/...` (module mount-path convention, see root CLAUDE.md
 * "Conventions").
 *
 * Per ADR 007, the only place a `TenantContext` is constructed from a raw
 * request is here — `RoutingService.complete` receives it as an explicit
 * parameter. This module does not implement authentication itself; it
 * expects the gateway (or, at this stage, the caller) to supply tenant/user
 * identity via headers, matching the dev-mode pattern used in
 * `services/brain/src/routes.ts` until a real session-token-to-context
 * bridge is wired in front of every module.
 */

import { Router, type Request, type Response } from 'express';
import { buildTenantContext, type TenantContext } from '@voai/auth-context';
import { isPlatformError, ValidationError } from '@voai/errors';
import type { RoutingService } from './routing-service.js';
import type { LlmMessage } from './provider.js';

function handleError(err: unknown, res: Response): void {
  if (isPlatformError(err)) {
    res.status(err.httpStatus).json({ error: err.code, message: err.message, details: err.details });
    return;
  }
  res.status(500).json({ error: 'INTERNAL', message: 'unexpected error' });
}

/**
 * Builds a `TenantContext` from request headers. Until the gateway wires a
 * shared session-token-to-context middleware in front of every module,
 * each module resolves tenant context for itself at the request boundary.
 * Header names mirror the `TenantContext` fields exactly: `x-tenant-id`,
 * `x-user-id`, `x-user-type`, `x-session-id`.
 */
function tenantContextFromRequest(req: Request): TenantContext {
  return buildTenantContext({
    tenantId: req.header('x-tenant-id'),
    userId: req.header('x-user-id'),
    userType: req.header('x-user-type'),
    sessionId: req.header('x-session-id'),
  });
}

function isLlmMessage(value: unknown): value is LlmMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (v.role === 'user' || v.role === 'assistant') && typeof v.content === 'string';
}

function parseCompletionBody(body: unknown): { systemPrompt: string; messages: LlmMessage[]; maxTokens?: number } {
  if (typeof body !== 'object' || body === null) {
    throw new ValidationError('request body must be a JSON object');
  }
  const b = body as Record<string, unknown>;

  if (typeof b.systemPrompt !== 'string') {
    throw new ValidationError('systemPrompt must be a string');
  }
  if (!Array.isArray(b.messages) || b.messages.length === 0 || !b.messages.every(isLlmMessage)) {
    throw new ValidationError(
      "messages must be a non-empty array of { role: 'user' | 'assistant', content: string }",
    );
  }
  if (b.maxTokens !== undefined && (typeof b.maxTokens !== 'number' || b.maxTokens <= 0)) {
    throw new ValidationError('maxTokens must be a positive number when provided');
  }

  return {
    systemPrompt: b.systemPrompt,
    messages: b.messages,
    maxTokens: b.maxTokens as number | undefined,
  };
}

export function buildRoutingRouter(routingService: RoutingService): Router {
  const router = Router();

  router.post('/complete', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromRequest(req);
      const request = parseCompletionBody(req.body);
      const result = await routingService.complete(tenantContext, request);
      res.status(200).json(result);
    } catch (err) {
      handleError(err, res);
    }
  });

  return router;
}
