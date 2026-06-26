/**
 * Ledger Service
 *
 * Decisions, actions, conflicts. Seven action lifecycle states (Pending, In Progress, Completed, Cancelled, Blocked, Snoozed, Delegated_to_expert). Four decision states. End-of-meeting extraction with three confirmation tiers (routine, substantive, high-stakes).
 *
 * Sprint reference: Phase 3, Sprints 3.2 and 3.3
 *
 * This module is a stub at the skeleton stage. It exposes the ModuleDefinition
 * contract so the API gateway can register it and CI can verify the build.
 * Real handlers, persistence, and tests are added in the sprint above.
 */

import express from 'express';
import type { ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';

export const ledgerModule: ModuleDefinition = {
  name: 'ledger',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'ledger' });
    const router = express.Router();

    router.get('/healthz', (_req, res) => {
      res.json({ module: 'ledger', status: 'healthy' });
    });

    log.info('module registered');

    return {
      name: 'ledger',
      router,
      health: async () => ({ status: 'healthy' }),
      shutdown: async () => {
        log.info('module shutdown');
      },
    };
  },
};

export default ledgerModule;
