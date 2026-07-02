/**
 * HTTP routes for the meeting module. Mounted by the gateway at
 * `/v1/meeting/...` (module mount-path convention, see root CLAUDE.md
 * "Conventions").
 *
 * Per ADR 007, `TenantContext` is constructed once per request from
 * already-authenticated headers the API gateway attaches after resolving
 * the caller's session token via identity-and-tenancy (`x-tenant-id`,
 * `x-user-id`, `x-user-type`, `x-session-id`). This module does not
 * authenticate the caller itself — that is identity-and-tenancy's
 * responsibility — it only requires the context to already be present.
 * Pattern matches services/brain/src/routes.ts and services/ledger/src/routes.ts.
 */

import { Router, type Request, type Response } from 'express';
import { buildTenantContext } from '@voai/auth-context';
import type { PostgresClient } from '@voai/db';
import type { Logger } from '@voai/types';
import { isPlatformError, ValidationError } from '@voai/errors';
import { startSession, getSession, endSession, type SessionMode } from './sessions.js';
import { appendTranscriptEntry, getTranscript, type SpeakerType } from './transcript.js';
import type { SseManager } from './sse.js';
import { AccessToken } from 'livekit-server-sdk';

function requireParam(req: Request, name: string): string {
  const value = req.params[name];
  if (!value) throw new ValidationError(`${name} path parameter is required`);
  return value;
}

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
    res.status(err.httpStatus).json({ error: err.code, message: err.message, details: err.details });
    return;
  }
  // No silent catches: anything that isn't a known PlatformError is
  // unexpected and must be logged before returning the generic 500.
  log.error('unexpected error handling request', { error: err instanceof Error ? err.stack : String(err) });
  res.status(500).json({ error: 'INTERNAL', message: 'unexpected error' });
}

const SESSION_MODES: readonly SessionMode[] = ['typed', 'voice', 'mixed'];
const SPEAKER_TYPES: readonly SpeakerType[] = ['founder', 'agent'];

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

export function buildMeetingRouter(postgres: PostgresClient, log: Logger, sse: SseManager): Router {
  const router = Router();

  router.post('/sessions', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromHeaders(req);
      const body = req.body as Record<string, unknown>;
      if (body.mode !== undefined && !isOneOf(SESSION_MODES, body.mode)) {
        throw new ValidationError(`mode must be one of ${SESSION_MODES.join(', ')}`);
      }

      const session = await startSession(tenantContext, postgres, {
        mode: isOneOf(SESSION_MODES, body.mode) ? body.mode : undefined,
      });
      res.status(201).json(session);
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.get('/sessions/:id', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromHeaders(req);
      const session = await getSession(tenantContext, postgres, requireParam(req, 'id'));
      if (!session) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'session not found' });
        return;
      }
      res.status(200).json(session);
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.post('/sessions/:id/transcript', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromHeaders(req);
      const body = req.body as Record<string, unknown>;
      if (!isOneOf(SPEAKER_TYPES, body.speakerType)) {
        throw new ValidationError(`speakerType must be one of ${SPEAKER_TYPES.join(', ')}`);
      }
      if (typeof body.speakerName !== 'string') throw new ValidationError('speakerName is required');
      if (typeof body.content !== 'string') throw new ValidationError('content is required');

      const entry = await appendTranscriptEntry(tenantContext, postgres, {
        sessionId: requireParam(req, 'id'),
        speakerType: body.speakerType,
        speakerName: body.speakerName,
        content: body.content,
      });
      res.status(201).json(entry);
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.get('/sessions/:id/transcript', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromHeaders(req);
      const entries = await getTranscript(tenantContext, postgres, requireParam(req, 'id'));
      res.status(200).json({ entries });
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.post('/sessions/:id/end', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromHeaders(req);
      const session = await endSession(tenantContext, postgres, requireParam(req, 'id'));
      res.status(200).json(session);
    } catch (err) {
      handleError(err, res, log);
    }
  });

  /**
   * SSE stream for a meeting session. The browser connects once and stays
   * connected for the duration of the meeting. The server pushes `raise-hand`
   * events whenever a persona wants to add something. No polling needed.
   *
   * Browser usage:
   *   const es = new EventSource(`/v1/meeting/sessions/${id}/events`, {
   *     headers: { 'x-tenant-id': ..., 'x-user-id': ..., ... }
   *   });
   *   es.addEventListener('raise-hand', e => { ... JSON.parse(e.data) ... });
   */
  /**
   * SSE stream for a meeting session.
   *
   * Auth: EventSource does not support custom request headers in browsers,
   * so credentials are accepted from either headers (API clients) or query
   * params (browser EventSource). Query params take priority when present.
   * In production this would use a short-lived signed room token instead.
   */
  router.get('/sessions/:id/events', (req: Request, res: Response) => {
    const sessionId = requireParam(req, 'id');

    // Accept auth from query params (EventSource) or headers (API clients)
    const q = req.query as Record<string, string>;
    const tenantId  = q['x-tenant-id']  ?? req.header('x-tenant-id')  ?? '';
    const userId    = q['x-user-id']    ?? req.header('x-user-id')    ?? '';
    const userType  = q['x-user-type']  ?? req.header('x-user-type')  ?? 'founder';
    const sessionTk = q['x-session-id'] ?? req.header('x-session-id') ?? '';

    if (!tenantId || !userId || !sessionTk) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'missing tenant context' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    res.write(': connected\n\n');

    sse.add(sessionId, res);
    log.info('SSE client connected', { sessionId, tenantId, count: sse.connectionCount(sessionId) });

    req.on('close', () => {
      sse.remove(sessionId, res);
      log.info('SSE client disconnected', { sessionId, count: sse.connectionCount(sessionId) });
    });
  });

  /**
   * Generate a LiveKit access token for the calling user to join a voice session.
   *
   * The token grants publish+subscribe on the room named `sessionId` and expires
   * in 4 hours (typical meeting length upper bound).
   *
   * Returns { token, livekitUrl } when LiveKit is configured via environment
   * variables (LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL).
   * Returns { error: 'VOICE_NOT_CONFIGURED' } with 422 when credentials are absent
   * so the client can gracefully fall back to typed mode.
   */
  router.post('/sessions/:id/voice-token', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromHeaders(req);
      const sessionId = requireParam(req, 'id');

      const livekitApiKey = process.env['LIVEKIT_API_KEY'];
      const livekitApiSecret = process.env['LIVEKIT_API_SECRET'];
      const livekitUrl = process.env['LIVEKIT_URL'];

      if (!livekitApiKey || !livekitApiSecret || !livekitUrl) {
        res.status(422).json({
          error: 'VOICE_NOT_CONFIGURED',
          message: 'LiveKit credentials not set — voice mode unavailable',
        });
        return;
      }

      // Verify the session exists and belongs to this tenant
      const session = await getSession(tenantContext, postgres, sessionId);
      if (!session) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'session not found' });
        return;
      }

      const at = new AccessToken(livekitApiKey, livekitApiSecret, {
        identity: tenantContext.userId,
        name: `user-${tenantContext.userId}`,
        ttl: '4h',
      });
      at.addGrant({
        roomJoin: true,
        room: sessionId,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });

      const token = await at.toJwt();
      log.info('voice token issued', { sessionId, userId: tenantContext.userId });
      res.status(200).json({ token, livekitUrl });
    } catch (err) {
      handleError(err, res, log);
    }
  });

  return router;
}
