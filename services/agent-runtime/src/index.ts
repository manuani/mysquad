/**
 * Agent Runtime
 *
 * Persona loading, contribution generation, sub-agent dispatch (brain retriever, calculator, document analyst, web search), scoped-context invocation for marketplace specialists. Calls Routing Service for every LLM dispatch.
 *
 * Sprint reference: Phase 2, Sprint 2.1.1; Phase 4, Sprints 4.2-4.3
 *
 * This module is a stub at the skeleton stage. It exposes the ModuleDefinition
 * contract so the API gateway can register it and CI can verify the build.
 * Real handlers, persistence, and tests are added in the sprint above.
 */

import express from 'express';
import type { ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';

export const agent_runtimeModule: ModuleDefinition = {
  name: 'agent-runtime',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'agent-runtime' });
    const router = express.Router();

    router.get('/healthz', (_req, res) => {
      res.json({ module: 'agent-runtime', status: 'healthy' });
    });

    log.info('module registered');

    return {
      name: 'agent-runtime',
      router,
      health: async () => ({ status: 'healthy' }),
      shutdown: async () => {
        log.info('module shutdown');
      },
    };
  },
};

export default agent_runtimeModule;
