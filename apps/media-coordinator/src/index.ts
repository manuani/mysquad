/**
 * Media Coordinator — HTTP API for voice session management.
 *
 * Endpoints:
 *   POST /sessions/:id/start     — spin up a pipeline session for voice mode
 *   POST /sessions/:id/audio     — receive raw PCM audio chunks (binary body)
 *   POST /sessions/:id/end       — shut down pipeline session
 *   GET  /sessions/:id/status    — current session state
 *   GET  /healthz                — health probe
 *
 * The media-coordinator runs as a separate process from the api-server
 * (different port, same Docker image or standalone container) because
 * real-time audio has different scaling characteristics than HTTP traffic.
 * It calls the api-server's agent-runtime endpoint over HTTP.
 */

import express, { type Request, type Response } from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { createLogger } from '@voai/telemetry';
import { loadVoiceConfig } from './voice-config.js';
import { createSttClient } from './stt.js';
import { createTtsClient } from './tts.js';
import { createWhipPublisher } from './whip-publisher.js';
import {
  createPipelineSession,
  type PipelineContribution,
  type PipelineSession,
} from './pipeline.js';

const config = loadVoiceConfig();
const log = createLogger({ level: 'info', service: 'media-coordinator', bindings: {} });

const stt = createSttClient(config.deepgramApiKey);
const tts = createTtsClient(config.elevenLabsApiKey);

// In-memory session registry. In production this would be Redis for
// multi-instance coordination, but the process-per-room model means a
// single instance handles all sessions it owns.
interface SessionState {
  readonly pipeline: PipelineSession;
  readonly contributions: PipelineContribution[][];
  readonly transcriptChunks: Array<{ text: string; isFinal: boolean; at: string }>;
  readonly livekitRoomName: string | undefined;
  wsListeners?: Array<(contributions: PipelineContribution[]) => void>;
  transcriptListeners?: Array<(text: string, isFinal: boolean) => void>;
}

const sessions = new Map<string, SessionState>();

const app = express();

// Allow browser pages served from api-server (:3000) to call MC directly (:3001)
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-tenant-id, x-user-id, x-user-type, x-session-id');
  if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

app.use(express.raw({ type: 'application/octet-stream', limit: '1mb' }));
app.use(express.json({ limit: '256kb' }));

// Publisher is created once and shared — the router reference lets it register
// one-shot audio-serve routes dynamically per TTS buffer.
const publisher =
  config.livekitUrl && config.livekitApiKey && config.livekitApiSecret
    ? createWhipPublisher({
        livekitUrl: config.livekitUrl,
        livekitApiKey: config.livekitApiKey,
        livekitApiSecret: config.livekitApiSecret,
        router: app,
        log,
      })
    : undefined;

app.get('/healthz', async (_req: Request, res: Response) => {
  // Report what is actually true rather than a constant 'healthy'. The
  // api-server is a hard dependency — without it a transcript can never reach
  // an advisor — so it is probed for real. Missing STT/TTS credentials leave
  // the process able to hold rooms but unable to hear or speak, which is
  // degraded rather than dead.
  const reasons: string[] = [];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
      const upstream = await fetch(`${config.apiServerUrl}/healthz`, { signal: controller.signal });
      if (!upstream.ok) reasons.push(`api-server returned ${upstream.status}`);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    reasons.push(`api-server unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }

  const status = reasons.length > 0 ? 'unhealthy' : config.isVoiceReady ? 'healthy' : 'degraded';
  if (status === 'degraded') reasons.push('voice credentials not configured — STT/TTS are no-ops');

  res.status(status === 'unhealthy' ? 503 : 200).json({
    status,
    ...(reasons.length > 0 ? { reason: reasons.join('; ') } : {}),
    voiceReady: config.isVoiceReady,
    activeSessions: sessions.size,
  });
});

app.post('/sessions/:id/start', (req: Request, res: Response) => {
  const sessionId = req.params['id'];
  if (!sessionId) {
    res.status(400).json({ error: 'sessionId required' });
    return;
  }
  if (sessions.has(sessionId)) {
    res.status(409).json({ error: 'session already active' });
    return;
  }

  const body = req.body as {
    tenantId?: string;
    userId?: string;
    sessionToken?: string;
    livekitRoomName?: string;
    /** Company and product names to boost in transcription. */
    vocabulary?: unknown;
    /** Meeting session UUID, so advisors can read the agenda for it. */
    meetingSessionId?: string;
  };
  if (!body.tenantId || !body.userId || !body.sessionToken) {
    res.status(400).json({ error: 'tenantId, userId, sessionToken required' });
    return;
  }
  const livekitRoomName = typeof body.livekitRoomName === 'string' ? body.livekitRoomName : undefined;
  const vocabulary = Array.isArray(body.vocabulary)
    ? body.vocabulary.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, 50)
    : undefined;

  const authHeaders = {
    'x-tenant-id': body.tenantId,
    'x-user-id': body.userId,
    'x-user-type': 'founder',
    'x-session-id': body.sessionToken,
  };

  const state: SessionState = {
    pipeline: createPipelineSession(stt, tts, {
      sessionId,
      tenantId: body.tenantId,
      userId: body.userId,
      apiServerUrl: config.apiServerUrl,
      authHeaders,
      livekitRoomName,
      vocabulary,
      ...(typeof body.meetingSessionId === 'string'
        ? { meetingSessionId: body.meetingSessionId }
        : {}),
      publisher,
      selfBaseUrl: config.selfBaseUrl,
      onContributions: (contributions) => {
        (state.contributions as PipelineContribution[][]).push(contributions);
        log.info('contributions generated', {
          sessionId,
          count: contributions.length,
          published: contributions.filter((c) => c.ingressId).length,
        });
        // Notify any open WebSocket listeners
        state.wsListeners?.forEach((fn) => fn(contributions));
      },
      onTranscriptChunk: (text, isFinal) => {
        (state.transcriptChunks as Array<{ text: string; isFinal: boolean; at: string }>).push({
          text,
          isFinal,
          at: new Date().toISOString(),
        });
        // Push transcript to WS clients
        state.transcriptListeners?.forEach((fn) => fn(text, isFinal));
      },
      onError: (err) => {
        log.error('pipeline error', { sessionId, err: err.message });
      },
    }),
    contributions: [],
    transcriptChunks: [],
    livekitRoomName,
  };

  sessions.set(sessionId, state);
  log.info('voice session started', { sessionId });
  res.status(201).json({ sessionId, status: 'active' });
});

app.post('/sessions/:id/audio', (req: Request, res: Response) => {
  const sessionId = req.params['id'];
  const state = sessions.get(sessionId ?? '');
  if (!state) {
    res.status(404).json({ error: 'session not found' });
    return;
  }

  if (!Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: 'body must be raw PCM binary' });
    return;
  }

  state.pipeline.sendAudio(req.body);
  res.status(204).send();
});

app.get('/sessions/:id/status', (req: Request, res: Response) => {
  const sessionId = req.params['id'];
  const state = sessions.get(sessionId ?? '');
  if (!state) {
    res.status(404).json({ error: 'session not found' });
    return;
  }

  res.json({
    sessionId,
    status: 'active',
    livekitRoomName: state.livekitRoomName ?? null,
    contributionBatches: state.contributions.length,
    transcriptChunks: state.transcriptChunks.length,
    recentTranscript: state.transcriptChunks.slice(-5),
    recentContributions: state.contributions.slice(-1),
  });
});

app.post('/sessions/:id/end', (req: Request, res: Response) => {
  const sessionId = req.params['id'];
  const state = sessions.get(sessionId ?? '');
  if (!state) {
    res.status(404).json({ error: 'session not found' });
    return;
  }

  state.pipeline.close();
  sessions.delete(sessionId ?? '');
  log.info('voice session ended', { sessionId });
  res.json({ sessionId, status: 'ended' });
});

// WebSocket server for real-time audio streaming.
// Browser connects to ws://media-coordinator:3001/sessions/:id/ws
// and sends raw PCM frames as binary messages (linear16, 16kHz, mono).
// The server pipes them directly to the Deepgram STT session.
// SSE events (transcript chunks, contributions) are broadcast back over the
// same socket as JSON text frames so the browser can update the live transcript.
const httpServer = createServer(app);
const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  const url = req.url ?? '';
  const match = url.match(/^\/sessions\/([^/]+)\/ws$/);
  if (!match) {
    socket.destroy();
    return;
  }
  const sessionId = match[1];
  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    const state = sessions.get(sessionId ?? '');
    if (!state) {
      ws.send(JSON.stringify({ type: 'error', message: 'session not found' }));
      ws.close();
      return;
    }
    log.info('WebSocket audio stream connected', { sessionId });

    // Patch onTranscriptChunk to also push over WebSocket
    const origPipeline = state.pipeline;
    // Binary frames are microphone audio; text frames are the founder typing.
    // The browser sends both over this one socket so a meeting can move between
    // speaking and typing without reconnecting.
    ws.on('message', (data: Buffer | ArrayBuffer, isBinary: boolean) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);

      if (isBinary) {
        origPipeline.sendAudio(buf);
        return;
      }

      try {
        const msg = JSON.parse(buf.toString('utf8')) as { type?: string; text?: unknown };
        if (msg.type === 'message' && typeof msg.text === 'string') {
          log.info('typed message received', { sessionId });
          origPipeline.sendTypedMessage(msg.text);
        }
      } catch {
        // A text frame that is not JSON is not something this protocol defines.
        // Ignoring it is safer than treating it as audio, which would corrupt
        // the Deepgram stream mid-utterance.
        log.warn('unparseable text frame ignored', { sessionId });
      }
    });

    // Push transcript chunks over WS
    const pushTranscript = (text: string, isFinal: boolean) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'transcript', text, isFinal }));
      }
    };
    (state.transcriptListeners ??= []).push(pushTranscript);

    // Push AI contributions over WS
    const pushContributions = (contributions: PipelineContribution[]) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'contributions',
          contributions: contributions.map((c) => ({
            agentName: c.agentName,
            role: c.role,
            text: c.text,
            rank: c.rank,
            // Ship the TTS audio to the browser directly. LiveKit URL ingress
            // (the `ingressId` path) needs a publicly reachable selfBaseUrl,
            // which localhost is not — so in local dev that path yields nothing
            // and this is the only way the advisors are actually heard.
            audioMp3: c.audio ? c.audio.toString('base64') : null,
          })),
        }));
      }
    };
    (state.wsListeners ??= []).push(pushContributions);

    ws.on('close', () => {
      log.info('WebSocket audio stream closed', { sessionId });
      if (state.wsListeners) {
        const idx = state.wsListeners.indexOf(pushContributions);
        if (idx !== -1) state.wsListeners.splice(idx, 1);
      }
      if (state.transcriptListeners) {
        const idx = state.transcriptListeners.indexOf(pushTranscript);
        if (idx !== -1) state.transcriptListeners.splice(idx, 1);
      }
    });
  });
});

const server = httpServer.listen(config.port, () => {
  log.info('media-coordinator listening', { port: config.port, voiceReady: config.isVoiceReady });
  if (!config.isVoiceReady) {
    log.warn('voice credentials not configured — STT/TTS will be no-ops', {
      missing: [
        !config.livekitUrl && 'LIVEKIT_URL',
        !config.deepgramApiKey && 'DEEPGRAM_API_KEY',
        !config.elevenLabsApiKey && 'ELEVENLABS_API_KEY',
      ].filter(Boolean),
    });
  }
});

process.on('SIGTERM', () => {
  log.info('shutdown signal received');
  for (const [id, state] of sessions) {
    state.pipeline.close();
    log.info('closed session on shutdown', { id });
  }
  server.close(() => process.exit(0));
});
