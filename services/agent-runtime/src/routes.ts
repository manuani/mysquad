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
import type { PostgresClient } from '@voai/db';
import { isPlatformError, ValidationError } from '@voai/errors';
import type { RoutingService } from '@voai/routing';
import type { EventBus, Logger } from '@voai/types';
import { AgentRuntime } from './agent-runtime.js';
import { fetchBrainContextForMessage } from './brain-context.js';
import { SARAH_CFO_PERSONA } from './personas/sarah-cfo.js';
import { PRIYA_CMO_PERSONA } from './personas/priya-cmo.js';
import { MARCUS_DEVILS_ADVOCATE_PERSONA } from './personas/marcus-devils-advocate.js';
import type { AgentPersona } from './personas/sarah-cfo.js';

/**
 * The full default roster this showcase build exposes. Real roster
 * composition is stage-and-industry adapted per Platform Spec §5.1 and
 * is Phase 4 scope — this is a fixed list for demonstrating the
 * multi-agent claim, not the real onboarding-driven roster logic.
 */
const ROSTER: readonly AgentPersona[] = [SARAH_CFO_PERSONA, PRIYA_CMO_PERSONA, MARCUS_DEVILS_ADVOCATE_PERSONA];

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

export function buildAgentRuntimeRouter(
  routingService: RoutingService,
  log: Logger,
  postgres: PostgresClient,
  events: EventBus,
): Router {
  const router = Router();
  const runtime = new AgentRuntime(routingService);

  router.post('/contributions', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromRequest(req);
      const body = req.body as { message?: unknown };
      if (typeof body.message !== 'string' || body.message.trim().length === 0) {
        throw new ValidationError('message is required');
      }

      const brainContext = await fetchBrainContextForMessage(tenantContext, postgres, body.message).catch(
        (err: unknown) => {
          log.warn('brain context fetch failed, continuing without it', { err: String(err) });
          return [];
        },
      );

      const contribution = await runtime.generateContribution(tenantContext, SARAH_CFO_PERSONA, {
        message: body.message,
        brainContext,
      });

      res.status(200).json(contribution);
    } catch (err) {
      handleError(err, res, log);
    }
  });

  /**
   * The multi-agent showcase endpoint: dispatches the same founder
   * message to the full roster in parallel and returns every persona's
   * contribution. This is deliberately NOT the ADR 011 hand-raise/
   * collision-arbiter pipeline — see agent-runtime.ts's
   * `generateRosterContributions` for why this is the smallest unit of
   * proof for the multi-agent claim, not the real Phase 4 implementation.
   */
  router.post('/contributions/roster', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromRequest(req);
      const body = req.body as { message?: unknown; sessionId?: unknown };
      if (typeof body.message !== 'string' || body.message.trim().length === 0) {
        throw new ValidationError('message is required');
      }
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;

      const brainContext = await fetchBrainContextForMessage(tenantContext, postgres, body.message).catch(
        (err: unknown) => {
          log.warn('brain context fetch failed, continuing without it', { err: String(err) });
          return [];
        },
      );

      const { ordered, skipped } = await runtime.generateOrderedContributions(
        tenantContext,
        ROSTER,
        { message: body.message, brainContext },
      );

      res.status(200).json({
        contributions: ordered.map((r) => ({
          agentName: r.persona.name,
          role: r.persona.role,
          contribution: r.contribution,
          rank: r.rank,
          compositeScore: r.compositeScore,
          error: null,
          skipped: false,
        })),
        skippedCount: skipped.length,
      });

      // Observer loop: fire async after response is sent.
      if (sessionId && skipped.length > 0) {
        const contributionsSoFar = ordered.map((r) => r.contribution.content);
        runtime
          .observeSkippedPersonas(
            tenantContext,
            skipped,
            { message: body.message, contributionsSoFar },
            sessionId,
            events,
          )
          .catch((err: unknown) => {
            log.warn('observer loop error (non-blocking)', { err: String(err) });
          });
      }
    } catch (err) {
      handleError(err, res, log);
    }
  });

  return router;
}
