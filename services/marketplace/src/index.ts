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
import type { HealthStatus, ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';
import type { PostgresClient, Neo4jClient } from '@voai/db';
import { checkDependencies } from '@voai/db';
import { buildMarketplaceRouter } from './routes.js';

export type {
  ExpertProfile,
  ExpertDomainTag,
  ExpertWithTags,
  CreateExpertInput,
  UpdateExpertInput,
} from './experts.js';
export {
  createExpert,
  getExpert,
  listExperts,
  updateExpert,
  addExpertDomainTag,
} from './experts.js';

export type { MatchedExpert } from './matching.js';
export { matchExperts, scoreExpert } from './matching.js';

export type { EscalationEvent, CreateEscalationInput } from './escalation.js';
export { recordEscalation, updateEscalationStatus, getSessionEscalations } from './escalation.js';

export type { AvailableSlot, BookingRecord, CreateBookingInput } from './booking.js';
export { getAvailableSlots, createBooking } from './booking.js';

export type { GraphClient } from './graph.js';
export { indexExpertDomains, graphMatchExperts, removeExpertFromGraph } from './graph.js';

export const marketplaceModule: ModuleDefinition = {
  name: 'marketplace',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'marketplace' });
    const postgres = ctx.db.postgres as PostgresClient;
    const neo4jClient = (ctx.db.neo4j as Neo4jClient | null) ?? null;

    const router = express.Router();
    router.use(buildMarketplaceRouter(postgres, log, { neo4j: neo4jClient }));

    // Postgres is required — without it nothing in this module answers. Neo4j
    // backs graph-based expert matching only, and the module already runs with
    // it absent, so an unreachable graph is degraded rather than unhealthy:
    // expert listing and booking still work off Postgres.
    const health = async (): Promise<HealthStatus> => {
      const core = await checkDependencies({ postgres });
      if (core.status !== 'healthy') return core;
      if (!neo4jClient) return { status: 'healthy' };

      const graph = await checkDependencies({ neo4j: neo4jClient });
      return graph.status === 'healthy'
        ? { status: 'healthy' }
        : { status: 'degraded', reason: `graph-based expert matching unavailable — ${graph.reason}` };
    };

    router.get('/healthz', async (_req, res) => {
      const status = await health();
      res.status(status.status === 'unhealthy' ? 503 : 200).json({ module: 'marketplace', ...status });
    });

    log.info('module registered');

    return {
      name: 'marketplace',
      router,
      health,
      shutdown: async () => {
        log.info('module shutdown');
      },
    };
  },
};

export default marketplaceModule;
