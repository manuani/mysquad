/**
 * Voice Gateway HTTP routes.
 *
 * All routes require the standard x-* auth headers (set by the caller after
 * resolving their session token). The auth context is attached by middleware
 * in api-server before these handlers run.
 *
 * Endpoints:
 *   POST /rooms                    — create a new voice meeting room
 *   GET  /rooms                    — list active rooms for this tenant
 *   GET  /rooms/:name/token        — issue a participant token (human joins)
 *   POST /rooms/:name/start-ai     — spin up AI bots for the room
 *   POST /rooms/:name/end          — end the room + trigger post-meeting summary
 *   GET  /healthz
 */

import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { buildTenantContext } from '@voai/auth-context';
import { UnauthenticatedError, ValidationError } from '@voai/errors';
import type { Logger } from '@voai/types';
import type { LiveKitClient } from './livekit-client.js';

function extractTenantContext(req: Request) {
  const tenantId = req.headers['x-tenant-id'];
  const userId = req.headers['x-user-id'];
  const userType = req.headers['x-user-type'];
  const sessionId = req.headers['x-session-id'];
  if (
    typeof tenantId !== 'string' ||
    typeof userId !== 'string' ||
    typeof userType !== 'string' ||
    typeof sessionId !== 'string'
  ) {
    throw new UnauthenticatedError('missing x-* auth headers');
  }
  return buildTenantContext({ tenantId, userId, userType: userType as 'founder', sessionId });
}

export interface VoiceGatewayRouterDeps {
  readonly livekit: LiveKitClient;
  readonly mediaCoordinatorUrl: string;
  readonly log: Logger;
}

export function buildVoiceGatewayRouter(deps: VoiceGatewayRouterDeps): Router {
  const { livekit, mediaCoordinatorUrl, log } = deps;
  const router = Router();

  router.get('/healthz', (_req: Request, res: Response) => {
    res.json({ status: 'healthy', mediaCoordinatorUrl });
  });

  // Create a voice meeting room
  router.post('/rooms', async (req: Request, res: Response) => {
    try {
      const ctx = extractTenantContext(req);
      const { title } = req.body as { title?: string };

      // Room name encodes tenantId for isolation + unique suffix
      const roomName = `${ctx.tenantId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
      const room = await livekit.createRoom(roomName, 600); // 10 min empty timeout

      log.info('voice room created', { roomName, tenantId: ctx.tenantId });
      res.status(201).json({ roomName: room.name, title: title ?? roomName, createdAt: new Date().toISOString() });
    } catch (err) {
      handleError(err, res, log);
    }
  });

  // Issue a participant token so a human can join
  router.post('/rooms/:name/token', async (req: Request, res: Response) => {
    try {
      const ctx = extractTenantContext(req);
      const roomName = req.params['name'];
      if (!roomName) throw new ValidationError('room name required');

      // Ensure the room belongs to this tenant (prefix check)
      if (!roomName.startsWith(ctx.tenantId.slice(0, 8))) {
        throw new UnauthenticatedError('room does not belong to this tenant');
      }

      const { displayName } = req.body as { displayName?: string };
      const identity = `human-${ctx.userId.slice(0, 8)}`;

      const token = await livekit.issueToken({
        roomName,
        identity,
        displayName: displayName ?? identity,
        canPublish: true,
        canSubscribe: true,
      });

      res.json(token);
    } catch (err) {
      handleError(err, res, log);
    }
  });

  // Spin up AI bots in the room (calls media-coordinator)
  router.post('/rooms/:name/start-ai', async (req: Request, res: Response) => {
    try {
      const ctx = extractTenantContext(req);
      const roomName = req.params['name'];
      if (!roomName) throw new ValidationError('room name required');

      if (!roomName.startsWith(ctx.tenantId.slice(0, 8))) {
        throw new UnauthenticatedError('room does not belong to this tenant');
      }

      const { sessionToken } = req.body as { sessionToken?: string };
      if (!sessionToken) throw new ValidationError('sessionToken required');

      // Create a meeting session ID to track this voice meeting
      const voiceSessionId = randomUUID();

      // Tell media-coordinator to start monitoring this room
      const mcRes = await fetch(`${mediaCoordinatorUrl}/sessions/${voiceSessionId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          sessionToken,
          livekitRoomName: roomName,
        }),
      });

      if (!mcRes.ok) {
        const err = await mcRes.json().catch(() => ({ message: 'media-coordinator error' }));
        throw new Error((err as { message: string }).message);
      }

      // Issue bot tokens for each AI persona (so they can be addressed by name in LiveKit UI)
      const personas = [
        { id: 'sarah-cfo', name: 'Sarah Chen (CFO)' },
        { id: 'priya-cmo', name: 'Priya Reddy (CMO)' },
        { id: 'marcus-da', name: 'Marcus Webb (Challenger)' },
      ];

      const botTokens = await Promise.all(personas.map((p) =>
        livekit.issueToken({
          roomName,
          identity: p.id,
          displayName: p.name,
          canPublish: true,
          canSubscribe: false,
          ttlSeconds: 7200,
        }),
      ));

      log.info('AI bots started for room', { roomName, voiceSessionId, tenantId: ctx.tenantId });
      res.status(201).json({ voiceSessionId, roomName, botTokens });
    } catch (err) {
      handleError(err, res, log);
    }
  });

  // End the room and trigger post-meeting summary
  router.post('/rooms/:name/end', async (req: Request, res: Response) => {
    try {
      const ctx = extractTenantContext(req);
      const roomName = req.params['name'];
      if (!roomName) throw new ValidationError('room name required');

      if (!roomName.startsWith(ctx.tenantId.slice(0, 8))) {
        throw new UnauthenticatedError('room does not belong to this tenant');
      }

      const { voiceSessionId } = req.body as { voiceSessionId?: string };

      // Stop the media-coordinator session
      if (voiceSessionId) {
        await fetch(`${mediaCoordinatorUrl}/sessions/${voiceSessionId}/end`, {
          method: 'POST',
        }).catch((e) => log.warn('media-coordinator end error', { err: String(e) }));
      }

      // Delete the LiveKit room (disconnects all participants)
      await livekit.deleteRoom(roomName);

      log.info('voice room ended', { roomName, voiceSessionId, tenantId: ctx.tenantId });
      res.json({ roomName, status: 'ended' });
    } catch (err) {
      handleError(err, res, log);
    }
  });

  return router;
}

function handleError(err: unknown, res: Response, log: Logger): void {
  if (err instanceof UnauthenticatedError) {
    res.status(401).json({ error: err.code, message: err.message });
    return;
  }
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.code, message: err.message });
    return;
  }
  log.error('voice-gateway unhandled error', { err: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ error: 'INTERNAL', message: 'unexpected error' });
}
