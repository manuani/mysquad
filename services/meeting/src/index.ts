/**
 * Meeting Service
 *
 * Meeting lifecycle, real-time pipeline coordination (LiveKit/STT/TTS), transcript persistence, end-of-meeting hooks. Owns the meeting state machine.
 *
 * Sprint reference: Phase 2 — Single-Agent Meeting (Sprints 2.1-2.3)
 *
 * This module is a stub at the skeleton stage. It exposes the ModuleDefinition
 * contract so the API gateway can register it and CI can verify the build.
 * Real handlers, persistence, and tests are added in the sprint above.
 */

import express from 'express';
import type { ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';

export const meetingModule: ModuleDefinition = {
  name: 'meeting',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'meeting' });
    const router = express.Router();

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
