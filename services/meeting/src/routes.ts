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

export function buildMeetingRouter(postgres: PostgresClient, log: Logger): Router {
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

  return router;
}
