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
import { createLogger } from '@voai/telemetry';
import { loadVoiceConfig } from './voice-config.js';
import { createSttClient } from './stt.js';
import { createTtsClient } from './tts.js';
import { createPipelineSession, type PipelineContribution, type PipelineSession } from './pipeline.js';

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
}

const sessions = new Map<string, SessionState>();

const app = express();
app.use(express.raw({ type: 'application/octet-stream', limit: '1mb' }));
app.use(express.json({ limit: '256kb' }));

app.get('/healthz', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    voiceReady: config.isVoiceReady,
    activeSessions: sessions.size,
  });
});

app.post('/sessions/:id/start', (req: Request, res: Response) => {
  const sessionId = req.params['id'];
  if (!sessionId) { res.status(400).json({ error: 'sessionId required' }); return; }
  if (sessions.has(sessionId)) { res.status(409).json({ error: 'session already active' }); return; }

  const body = req.body as { tenantId?: string; userId?: string; sessionToken?: string };
  if (!body.tenantId || !body.userId || !body.sessionToken) {
    res.status(400).json({ error: 'tenantId, userId, sessionToken required' });
    return;
  }

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
      onContributions: (contributions) => {
        (state.contributions as PipelineContribution[][]).push(contributions);
        log.info('contributions generated', { sessionId, count: contributions.length });
      },
      onTranscriptChunk: (text, isFinal) => {
        (state.transcriptChunks as Array<{ text: string; isFinal: boolean; at: string }>).push({
          text,
          isFinal,
          at: new Date().toISOString(),
        });
      },
      onError: (err) => {
        log.error('pipeline error', { sessionId, err: err.message });
      },
    }),
    contributions: [],
    transcriptChunks: [],
  };

  sessions.set(sessionId, state);
  log.info('voice session started', { sessionId });
  res.status(201).json({ sessionId, status: 'active' });
});

app.post('/sessions/:id/audio', (req: Request, res: Response) => {
  const sessionId = req.params['id'];
  const state = sessions.get(sessionId ?? '');
  if (!state) { res.status(404).json({ error: 'session not found' }); return; }

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
  if (!state) { res.status(404).json({ error: 'session not found' }); return; }

  res.json({
    sessionId,
    status: 'active',
    contributionBatches: state.contributions.length,
    transcriptChunks: state.transcriptChunks.length,
    recentTranscript: state.transcriptChunks.slice(-5),
    recentContributions: state.contributions.slice(-1),
  });
});

app.post('/sessions/:id/end', (req: Request, res: Response) => {
  const sessionId = req.params['id'];
  const state = sessions.get(sessionId ?? '');
  if (!state) { res.status(404).json({ error: 'session not found' }); return; }

  state.pipeline.close();
  sessions.delete(sessionId ?? '');
  log.info('voice session ended', { sessionId });
  res.json({ sessionId, status: 'ended' });
});

const server = app.listen(config.port, () => {
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
