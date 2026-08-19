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
import { matchExperts } from '@voai/marketplace';
import { recordMeteringEvent } from '@voai/marketplace-metering';
import { AgentRuntime } from './agent-runtime.js';
import { createPlanResolver } from './tenant-plan.js';
import { getBrief, getSession, listDocuments } from '@voai/meeting';
import { getProfile } from '@voai/identity-and-tenancy';
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
const ROSTER: readonly AgentPersona[] = [
  SARAH_CFO_PERSONA,
  PRIYA_CMO_PERSONA,
  MARCUS_DEVILS_ADVOCATE_PERSONA,
];

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
    res
      .status(err.httpStatus)
      .json({ error: err.code, message: err.message, details: err.details });
    return;
  }
  // A prior bug in this repo was a silent catch block with no log line,
  // which is exactly how the bug stayed invisible until live-stack
  // exercise found it. Always log unexpected errors here.
  log.error('unexpected error in agent-runtime route', { err: String(err) });
  res.status(500).json({ error: 'INTERNAL', message: 'unexpected error' });
}

/**
 * How much of the conversation travels with each turn. Prior turns are inlined
 * into every persona's prompt, so this is a per-turn cost that grows with the
 * meeting. Six exchanges is enough to follow a thread; older context belongs in
 * the brain rather than in every request.
 */
const MAX_PRIOR_TURNS = 12;

export function buildAgentRuntimeRouter(
  routingService: RoutingService,
  log: Logger,
  postgres: PostgresClient,
  events: EventBus,
): Router {
  const router = Router();
  // Without a resolver every tenant routes at the 'starter' ceiling, which
  // is what left the advanced and high tiers unreachable.
  const runtime = new AgentRuntime(routingService, createPlanResolver(postgres, log));

  router.post('/contributions', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromRequest(req);
      const body = req.body as { message?: unknown; meetingSessionId?: unknown };
      if (typeof body.message !== 'string' || body.message.trim().length === 0) {
        throw new ValidationError('message is required');
      }

      // Which company this meeting is about. Read from the meeting session so
      // the advisors' brain, and everything they recall, belongs to the right
      // business — a founder running two would otherwise get one company's
      // numbers quoted into the other's meeting.
      const meetingSessionIdForScope =
        typeof body.meetingSessionId === 'string' ? body.meetingSessionId : null;
      const companyProfileId = meetingSessionIdForScope
        ? await getSession(tenantContext, postgres, meetingSessionIdForScope)
            .then((s) => s?.companyProfileId ?? undefined)
            .catch(() => undefined)
        : undefined;

      // Material the founder handed over, oldest first. Failing to read it must
      // never block the meeting — the advisors simply have not seen it.
      const documents = meetingSessionIdForScope
        ? await listDocuments(tenantContext, postgres, meetingSessionIdForScope).catch(
            (err: unknown) => {
              log.warn('document fetch failed, continuing without them', { err: String(err) });
              return [];
            },
          )
        : [];

      // The founder's preferences for this company, if they set any.
      const personality = companyProfileId
        ? await getProfile(tenantContext, postgres, companyProfileId)
            .then((p) =>
              p
                ? {
                    challengeLevel: p.challengeLevel as never,
                    replyLength: p.replyLength as never,
                    formality: p.formality as never,
                    teamInstructions: p.teamInstructions,
                  }
                : null,
            )
            .catch(() => null)
        : null;

      const brainContext = await fetchBrainContextForMessage(
        tenantContext,
        postgres,
        body.message,
        companyProfileId,
      ).catch((err: unknown) => {
        log.warn('brain context fetch failed, continuing without it', { err: String(err) });
        return [];
      });

      const requestId = (res.locals['requestId'] as string | undefined) ?? undefined;
      const contribution = await runtime.generateContribution(tenantContext, SARAH_CFO_PERSONA, {
        message: body.message,
        brainContext,
        requestId,
        // Asking one advisor should read the same material and respect the same
        // preferences as asking the room.
        documents,
        personality,
      });

      postgres
        .withTenant(tenantContext.tenantId, (client) =>
          recordMeteringEvent(tenantContext, client, {
            eventType: 'ai_roster_call',
            quantity: 1,
            metadata: { agents: 1 },
          }),
        )
        .catch((err: unknown) => log.warn('metering record failed', { err: String(err) }));

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
      const body = req.body as {
        message?: unknown;
        sessionId?: unknown;
        mode?: unknown;
        meetingSessionId?: unknown;
        priorTurns?: unknown;
      };
      if (typeof body.message !== 'string' || body.message.trim().length === 0) {
        throw new ValidationError('message is required');
      }
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;

      // Which company this meeting is about. Read from the meeting session so
      // the advisors' brain, and everything they recall, belongs to the right
      // business — a founder running two would otherwise get one company's
      // numbers quoted into the other's meeting.
      const meetingSessionIdForScope =
        typeof body.meetingSessionId === 'string' ? body.meetingSessionId : null;
      const companyProfileId = meetingSessionIdForScope
        ? await getSession(tenantContext, postgres, meetingSessionIdForScope)
            .then((s) => s?.companyProfileId ?? undefined)
            .catch(() => undefined)
        : undefined;

      // Material the founder handed over, oldest first. Failing to read it must
      // never block the meeting — the advisors simply have not seen it.
      const documents = meetingSessionIdForScope
        ? await listDocuments(tenantContext, postgres, meetingSessionIdForScope).catch(
            (err: unknown) => {
              log.warn('document fetch failed, continuing without them', { err: String(err) });
              return [];
            },
          )
        : [];

      // The founder's preferences for this company, if they set any.
      const personality = companyProfileId
        ? await getProfile(tenantContext, postgres, companyProfileId)
            .then((p) =>
              p
                ? {
                    challengeLevel: p.challengeLevel as never,
                    replyLength: p.replyLength as never,
                    formality: p.formality as never,
                    teamInstructions: p.teamInstructions,
                  }
                : null,
            )
            .catch(() => null)
        : null;

      const brainContext = await fetchBrainContextForMessage(
        tenantContext,
        postgres,
        body.message,
        companyProfileId,
      ).catch((err: unknown) => {
        log.warn('brain context fetch failed, continuing without it', { err: String(err) });
        return [];
      });

      const requestId = (res.locals['requestId'] as string | undefined) ?? undefined;
      const mode = body.mode === 'voice' ? 'voice' : 'typed';

      // What has already been said in this conversation. `priorTurns` was
      // threaded through agent-runtime from the start but never populated by
      // this route, so every turn was dispatched with only the latest utterance
      // — advisors could not refer back to anything said earlier in the meeting
      // they were in, which reads as an advisor who was not listening.
      const priorTurns = Array.isArray(body.priorTurns)
        ? body.priorTurns
            .filter(
              (t): t is { role: string; content: string } =>
                typeof t === 'object' &&
                t !== null &&
                typeof (t as { content?: unknown }).content === 'string',
            )
            .map((t) => ({
              role: t.role === 'assistant' ? ('assistant' as const) : ('user' as const),
              content: t.content,
            }))
            // Bounded here as well as by the caller: prior turns are inlined
            // into every persona's prompt, so an unbounded history would
            // inflate the cost of every later turn in a long meeting.
            .slice(-MAX_PRIOR_TURNS)
        : undefined;

      // The agenda the founder uploaded before the meeting, if any. Read via
      // @voai/meeting's typed export rather than querying its tables directly
      // (CLAUDE.md "Module boundaries are real"). A missing or unreadable brief
      // must never block the meeting — the advisors simply start cold, which is
      // the behaviour before briefs existed.
      const meetingSessionId =
        typeof body.meetingSessionId === 'string' ? body.meetingSessionId : null;
      const brief = meetingSessionId
        ? await getBrief(tenantContext, postgres, meetingSessionId).catch((err: unknown) => {
            log.warn('brief fetch failed, continuing without it', { err: String(err) });
            return null;
          })
        : null;

      const { ordered, skipped } = await runtime.generateOrderedContributions(
        tenantContext,
        ROSTER,
        {
          message: body.message,
          brainContext,
          requestId,
          mode,
          brief,
          priorTurns,
          documents,
          personality,
        },
      );

      postgres
        .withTenant(tenantContext.tenantId, (client) =>
          recordMeteringEvent(tenantContext, client, {
            eventType: 'ai_roster_call',
            quantity: 1,
            metadata: { agents: ordered.length },
          }),
        )
        .catch((err: unknown) => log.warn('metering record failed', { err: String(err) }));

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
            { message: body.message, contributionsSoFar, requestId },
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

  /**
   * Escalation trigger: when a persona identifies a topic that needs a real
   * expert, the frontend POSTs here with the session + topic. Returns the
   * top-matched expert(s) from the marketplace. Also records an escalation
   * event for tracking.
   *
   * POST /escalate { topic: string, sessionId: string }
   * → { experts: MatchedExpert[], escalationId: string }
   */
  router.post('/escalate', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromRequest(req);
      const body = req.body as { topic?: unknown; sessionId?: unknown };
      if (typeof body.topic !== 'string' || !body.topic.trim())
        throw new ValidationError('topic is required');
      const sessionId =
        typeof body.sessionId === 'string'
          ? body.sessionId
          : (tenantContext.sessionId ?? 'unknown');

      const experts = await postgres.withTenant(tenantContext.tenantId, (client) =>
        matchExperts(tenantContext, client, body.topic as string, 3),
      );

      events
        .publish({
          type: 'escalation.triggered',
          tenantId: tenantContext.tenantId,
          sessionId,
          topic: body.topic as string,
          topExpertIds: experts.slice(0, 3).map((e) => e.expert.id),
        } as never)
        .catch(() => {});

      res.status(200).json({ experts, sessionId });
    } catch (err) {
      handleError(err, res, log);
    }
  });

  return router;
}
