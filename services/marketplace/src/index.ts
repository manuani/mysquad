/**
 * Marketplace Service
 *
 * Three-layer expertise stack: default roster agents (subscription-gated),
 * marketplace specialist agents (loaded on-demand), human experts (closed
 * network at v1 with three engagement models). Hire/fire flows.
 * Multi-dimensional ratings.
 *
 * Sprint 9 implementation: expert profiles, domain tags, expert matching,
 * and escalation events. Scheduling and billing are Sprint 10–11 scope.
 */

import express from 'express';
import type { ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';
import type { PostgresClient } from '@voai/db';
import { buildMarketplaceRouter } from './routes.js';

export type { ExpertProfile, ExpertDomainTag, ExpertWithTags, CreateExpertInput, UpdateExpertInput } from './experts.js';
export { createExpert, getExpert, listExperts, updateExpert, addExpertDomainTag } from './experts.js';

export type { MatchedExpert } from './matching.js';
export { matchExperts, scoreExpert } from './matching.js';

export type { EscalationEvent, CreateEscalationInput } from './escalation.js';
export { recordEscalation, updateEscalationStatus, getSessionEscalations } from './escalation.js';

export const marketplaceModule: ModuleDefinition = {
  name: 'marketplace',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'marketplace' });
    const postgres = ctx.db.postgres as PostgresClient;

    const router = express.Router();
    router.use(buildMarketplaceRouter(postgres, log));

    router.get('/healthz', (_req, res) => {
      res.json({ module: 'marketplace', status: 'healthy' });
    });

    log.info('module registered');

    return {
      name: 'marketplace',
      router,
      health: async () => ({ status: 'healthy' }),
      shutdown: async () => {
        log.info('module shutdown');
      },
    };
  },
};

export default marketplaceModule;
