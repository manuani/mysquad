/**
 * HTTP routes for the marketplace module. Mounted at `/v1/marketplace/...`.
 *
 * Endpoints:
 *   POST   /experts                          — create expert profile
 *   GET    /experts                          — list experts (filter by domain, status)
 *   GET    /experts/:id                      — get expert + domain tags
 *   PATCH  /experts/:id                      — update expert profile
 *   POST   /experts/:id/tags                 — add domain tag
 *   POST   /match                            — match experts to a topic
 *   POST   /escalations                      — record AI → expert escalation event
 *   GET    /escalations?sessionId=           — list escalations for a session
 *   PATCH  /escalations/:id                  — accept or dismiss escalation
 */

import { Router, type Request, type Response } from 'express';
import { buildTenantContext } from '@voai/auth-context';
import type { PostgresClient } from '@voai/db';
import type { Logger } from '@voai/types';
import { isPlatformError, ValidationError } from '@voai/errors';
import {
  createExpert, getExpert, listExperts, updateExpert, addExpertDomainTag,
} from './experts.js';
import { matchExperts } from './matching.js';
import { recordEscalation, updateEscalationStatus, getSessionEscalations } from './escalation.js';
import { getAvailableSlots, createBooking } from './booking.js';
import { indexExpertDomains } from './graph.js';
import type { GraphClient } from './graph.js';

function tenantContextFromHeaders(req: Request) {
  return buildTenantContext({
    tenantId: req.header('x-tenant-id'),
    userId: req.header('x-user-id'),
    userType: req.header('x-user-type'),
    sessionId: req.header('x-session-id'),
  });
}

function handleError(err: unknown, res: Response, log: Logger): void {
  if (isPlatformError(err)) {
    res.status(err.httpStatus).json({ error: err.code, message: err.message });
    return;
  }
  log.error('unexpected marketplace error', { err: String(err) });
  res.status(500).json({ error: 'INTERNAL', message: 'unexpected error' });
}

export function buildMarketplaceRouter(
  postgres: PostgresClient,
  log: Logger,
  graphClient: GraphClient = { neo4j: null },
): Router {
  const router = Router();

  // ── Expert profile CRUD ─────────────────────────────────────────────────────

  router.post('/experts', async (req: Request, res: Response) => {
    try {
      const tc = tenantContextFromHeaders(req);
      const body = req.body as Record<string, unknown>;
      if (typeof body.name !== 'string' || !body.name.trim()) throw new ValidationError('name required');
      if (typeof body.email !== 'string' || !body.email.trim()) throw new ValidationError('email required');

      const expert = await postgres.withTenant(tc.tenantId, async (client) =>
        createExpert(tc, client, {
          name: body.name as string,
          email: body.email as string,
          bio: typeof body.bio === 'string' ? body.bio : undefined,
          linkedinUrl: typeof body.linkedinUrl === 'string' ? body.linkedinUrl : undefined,
          hourlyRateUsdCents: typeof body.hourlyRateUsdCents === 'number' ? body.hourlyRateUsdCents : undefined,
          domains: Array.isArray(body.domains) ? body.domains as Array<{ domain: string; confidence?: number }> : undefined,
        }),
      );
      // Index in Neo4j graph (non-blocking; degrades gracefully when Neo4j absent)
      indexExpertDomains(tc, graphClient, expert).catch((err: unknown) => {
        log.warn('neo4j expert index failed (non-blocking)', { expertId: expert.id, err: String(err) });
      });
      res.status(201).json(expert);
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.get('/experts', async (req: Request, res: Response) => {
    try {
      const tc = tenantContextFromHeaders(req);
      const q = req.query as Record<string, string>;
      const experts = await postgres.withTenant(tc.tenantId, async (client) =>
        listExperts(tc, client, {
          status: q['status'] as 'active' | 'pending' | 'paused' | 'retired' | undefined,
          domain: q['domain'],
          limit: q['limit'] ? parseInt(q['limit'], 10) : undefined,
        }),
      );
      res.status(200).json({ experts });
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.get('/experts/:id', async (req: Request, res: Response) => {
    try {
      const tc = tenantContextFromHeaders(req);
      const id = req.params['id']!;
      const expert = await postgres.withTenant(tc.tenantId, async (client) => getExpert(tc, client, id));
      if (!expert) { res.status(404).json({ error: 'NOT_FOUND', message: 'expert not found' }); return; }
      res.status(200).json(expert);
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.patch('/experts/:id', async (req: Request, res: Response) => {
    try {
      const tc = tenantContextFromHeaders(req);
      const id = req.params['id']!;
      const body = req.body as Record<string, unknown>;
      const expert = await postgres.withTenant(tc.tenantId, async (client) =>
        updateExpert(tc, client, id, {
          name: typeof body.name === 'string' ? body.name : undefined,
          bio: typeof body.bio === 'string' ? body.bio : undefined,
          linkedinUrl: typeof body.linkedinUrl === 'string' ? body.linkedinUrl : undefined,
          status: typeof body.status === 'string' ? body.status as 'active' | 'paused' | 'retired' : undefined,
          hourlyRateUsdCents: typeof body.hourlyRateUsdCents === 'number' ? body.hourlyRateUsdCents : undefined,
        }),
      );
      res.status(200).json(expert);
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.post('/experts/:id/tags', async (req: Request, res: Response) => {
    try {
      const tc = tenantContextFromHeaders(req);
      const id = req.params['id']!;
      const body = req.body as Record<string, unknown>;
      if (typeof body.domain !== 'string' || !body.domain.trim()) throw new ValidationError('domain required');
      const tag = await postgres.withTenant(tc.tenantId, async (client) =>
        addExpertDomainTag(tc, client, id, body.domain as string, typeof body.confidence === 'number' ? body.confidence : undefined),
      );
      // Re-index full expert in Neo4j (non-blocking)
      postgres.withTenant(tc.tenantId, (client) => getExpert(tc, client, id))
        .then((expert) => {
          if (expert) {
            return indexExpertDomains(tc, graphClient, expert);
          }
        })
        .catch((err: unknown) => {
          log.warn('neo4j re-index after tag add failed (non-blocking)', { expertId: id, err: String(err) });
        });
      res.status(201).json(tag);
    } catch (err) {
      handleError(err, res, log);
    }
  });

  // ── Expert matching ─────────────────────────────────────────────────────────

  router.post('/match', async (req: Request, res: Response) => {
    try {
      const tc = tenantContextFromHeaders(req);
      const body = req.body as Record<string, unknown>;
      if (typeof body.topic !== 'string' || !body.topic.trim()) throw new ValidationError('topic required');
      const topK = typeof body.topK === 'number' ? body.topK : 5;
      const matches = await postgres.withTenant(tc.tenantId, async (client) =>
        matchExperts(tc, client, body.topic as string, topK),
      );
      res.status(200).json({ matches, topic: body.topic });
    } catch (err) {
      handleError(err, res, log);
    }
  });

  // ── Expert booking ──────────────────────────────────────────────────────────

  router.get('/experts/:id/slots', async (req: Request, res: Response) => {
    try {
      const tc = tenantContextFromHeaders(req);
      const id = req.params['id']!;
      const date = (req.query as Record<string, string>)['date'];
      if (!date) throw new ValidationError('date query param required (YYYY-MM-DD)');
      const slots = await postgres.withTenant(tc.tenantId, async (client) =>
        getAvailableSlots(tc, client, id, date),
      );
      res.status(200).json({ slots });
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.post('/experts/:id/book', async (req: Request, res: Response) => {
    try {
      const tc = tenantContextFromHeaders(req);
      const id = req.params['id']!;
      const body = req.body as Record<string, unknown>;
      if (typeof body.slotStart !== 'string') throw new ValidationError('slotStart required');
      if (typeof body.founderEmail !== 'string') throw new ValidationError('founderEmail required');
      if (typeof body.topic !== 'string') throw new ValidationError('topic required');
      const booking = await postgres.withTenant(tc.tenantId, async (client) =>
        createBooking(tc, client, {
          expertId: id,
          slotStart: body.slotStart as string,
          founderEmail: body.founderEmail as string,
          topic: body.topic as string,
        }),
      );
      log.info('expert session booked', { bookingId: booking.id, expertId: id, calcomLinked: !!booking.calcomBookingId });
      res.status(201).json(booking);
    } catch (err) {
      handleError(err, res, log);
    }
  });

  // ── Escalation events ───────────────────────────────────────────────────────

  router.post('/escalations', async (req: Request, res: Response) => {
    try {
      const tc = tenantContextFromHeaders(req);
      const body = req.body as Record<string, unknown>;
      if (typeof body.sessionId !== 'string') throw new ValidationError('sessionId required');
      if (typeof body.personaName !== 'string') throw new ValidationError('personaName required');
      if (typeof body.topic !== 'string' || !body.topic.trim()) throw new ValidationError('topic required');

      const event = await postgres.withTenant(tc.tenantId, async (client) =>
        recordEscalation(tc, client, {
          sessionId: body.sessionId as string,
          personaName: body.personaName as string,
          topic: body.topic as string,
          suggestedExpertId: typeof body.suggestedExpertId === 'string' ? body.suggestedExpertId : undefined,
        }),
      );
      log.info('escalation recorded', { id: event.id, personaName: event.personaName });
      res.status(201).json(event);
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.get('/escalations', async (req: Request, res: Response) => {
    try {
      const tc = tenantContextFromHeaders(req);
      const q = req.query as Record<string, string>;
      if (!q['sessionId']) throw new ValidationError('sessionId query param required');
      const events = await postgres.withTenant(tc.tenantId, async (client) =>
        getSessionEscalations(tc, client, q['sessionId']!),
      );
      res.status(200).json({ events });
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.patch('/escalations/:id', async (req: Request, res: Response) => {
    try {
      const tc = tenantContextFromHeaders(req);
      const id = req.params['id']!;
      const body = req.body as Record<string, unknown>;
      if (body.status !== 'accepted' && body.status !== 'dismissed') {
        throw new ValidationError('status must be accepted or dismissed');
      }
      const event = await postgres.withTenant(tc.tenantId, async (client) =>
        updateEscalationStatus(tc, client, id, body.status as 'accepted' | 'dismissed'),
      );
      res.status(200).json(event);
    } catch (err) {
      handleError(err, res, log);
    }
  });

  return router;
}
