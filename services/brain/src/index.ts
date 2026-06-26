/**
 * Brain Service
 *
 * The eight knowledge domains stored across Postgres (structured), pgvector (semantic), and Neo4j (relationship graph). Ingestion from sessions, documents, integrations. Three query modes: semantic retrieval, structured metric, real-time contradiction check (P95 brain query target < 800ms).
 *
 * Sprint reference: Phase 3, Sprint 3.1 — Brain capture and storage
 *
 * This module is a stub at the skeleton stage. It exposes the ModuleDefinition
 * contract so the API gateway can register it and CI can verify the build.
 * Real handlers, persistence, and tests are added in the sprint above.
 */

import express from 'express';
import type { ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';

export const brainModule: ModuleDefinition = {
  name: 'brain',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'brain' });
    const router = express.Router();

    router.get('/healthz', (_req, res) => {
      res.json({ module: 'brain', status: 'healthy' });
    });

    log.info('module registered');

    return {
      name: 'brain',
      router,
      health: async () => ({ status: 'healthy' }),
      shutdown: async () => {
        log.info('module shutdown');
      },
    };
  },
};

export default brainModule;
