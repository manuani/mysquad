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
import type { PostgresClient } from '@voai/db';
import { buildMeetingRouter } from './routes.js';

export type { SessionMode, SessionRow, SessionStatus, StartSessionInput } from './sessions.js';
export { activateSession, endSession, getSession, startSession } from './sessions.js';

export type { AppendTranscriptEntryInput, SpeakerType, TranscriptEntryRow } from './transcript.js';
export { appendTranscriptEntry, getTranscript } from './transcript.js';

export { buildMeetingRouter } from './routes.js';

export const meetingModule: ModuleDefinition = {
  name: 'meeting',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'meeting' });

    // ctx.db.postgres is typed as `unknown` in @voai/types (module.ts
    // intentionally keeps DatabaseClients loosely typed there to avoid a
    // circular dependency on @voai/db); narrow it to the concrete
    // PostgresClient contract this module compiles against.
    const postgres = ctx.db.postgres as PostgresClient;

    const router = express.Router();
    router.use(buildMeetingRouter(postgres, log));

    router.get('/healthz', (_req, res) => {
      res.json({ module: 'meeting', status: 'healthy' });
    });

    log.info('module registered');

    return {
      name: 'meeting',
      router,
      health: async () => ({ status: 'healthy' }),
      shutdown: async () => {
        log.info('module shutdown');
      },
    };
  },
};

export default meetingModule;
