/**
 * Meeting Service
 *
 * Meeting lifecycle (started -> active -> ended), transcript persistence.
 *
 * Sprint reference: Phase 2 — Single-Agent Meeting, Deliverable 2.3.2
 * (End-to-end meeting flow).
 *
 * Scope of this implementation: backend state machine + persistence only,
 * typed mode. Real-time pipeline coordination (LiveKit/STT/TTS), voice/mixed
 * modes, and mobile UI are out of scope here — see README.md for the full
 * breakdown of what's implemented vs. deferred.
 */

import express from 'express';
import type { ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';
import type { RaiseHandEvent } from '@voai/events';
import type { PostgresClient } from '@voai/db';
import { checkDependencies } from '@voai/db';
import { buildMeetingRouter } from './routes.js';
import { SseManager } from './sse.js';

export type { SessionMode, SessionRow, SessionStatus, StartSessionInput } from './sessions.js';
export { activateSession, endSession, getSession, startSession } from './sessions.js';

export type { AppendTranscriptEntryInput, SpeakerType, TranscriptEntryRow } from './transcript.js';
export { appendTranscriptEntry, getTranscript } from './transcript.js';

export { buildMeetingRouter } from './routes.js';
export { getBrief, saveBrief, deleteBrief, MAX_BRIEF_CHARS } from './brief.js';
export type { MeetingBrief } from './brief.js';

export const meetingModule: ModuleDefinition = {
  name: 'meeting',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'meeting' });

    // ctx.db.postgres is typed as `unknown` in @voai/types (module.ts
    // intentionally keeps DatabaseClients loosely typed there to avoid a
    // circular dependency on @voai/db); narrow it to the concrete
    // PostgresClient contract this module compiles against.
    const postgres = ctx.db.postgres as PostgresClient;
    const sse = new SseManager();

    // Subscribe to raise-hand events published by agent-runtime after roster
    // calls. Fan out to every SSE client watching the relevant session.
    ctx.events.subscribe<RaiseHandEvent>('raise-hand', async (event) => {
      sse.emit(event.payload.sessionId, 'raise-hand', event.payload);
    });

    const router = express.Router();
    router.use(buildMeetingRouter(postgres, log, sse));

    router.get('/healthz', async (_req, res) => {
      const health = await checkDependencies({ postgres });
      res.status(health.status === 'healthy' ? 200 : 503).json({ module: 'meeting', ...health });
    });

    log.info('module registered');

    return {
      name: 'meeting',
      router,
      health: () => checkDependencies({ postgres }),
      shutdown: async () => {
        log.info('module shutdown');
      },
    };
  },
};

export default meetingModule;

export { listMeetings } from './session-list.js';
export type { MeetingSummary } from './session-list.js';

export { shareDocument, listDocuments, deleteDocument, MAX_DOCUMENT_CHARS } from './documents.js';
export type { MeetingDocument } from './documents.js';
export { extractText, kindForFilename, MAX_FILE_BYTES } from './extract-text.js';
export type { ExtractedDocument, DocumentKind } from './extract-text.js';
