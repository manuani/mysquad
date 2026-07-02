/**
 * Agent Runtime
 *
 * Persona loading, contribution generation, sub-agent dispatch (brain retriever, calculator, document analyst, web search), scoped-context invocation for marketplace specialists. Calls Routing Service for every LLM dispatch.
 *
 * Sprint reference: Phase 2, Sprint 2.1.1; Phase 4, Sprints 4.2-4.3
 *
 * Sprint 2.1.1 baseline (this implementation): a single agent persona
 * (Sarah Chen, CFO — `src/personas/sarah-cfo.ts`), a single-call
 * `AgentRuntime` (`src/agent-runtime.ts`) that loads that persona, accepts
 * founder input, calls `@voai/routing`'s `RoutingService` for a
 * completion, and returns a structured contribution. Multi-agent
 * dispatch, the hand-raise protocol, and sub-agent dispatch are Phase
 * 4 scope and not built here — see README.md "Status".
 */

import type { ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';
import type { PlatformConfig } from '@voai/config';
import type { PostgresClient } from '@voai/db';
import { AnthropicProvider, RoutingService } from '@voai/routing';
import { buildAgentRuntimeRouter } from './routes.js';

export { AgentRuntime } from './agent-runtime.js';
export type { AgentContribution, AgentContributionInput, ConversationTurn } from './agent-runtime.js';
export { SARAH_CFO_PERSONA } from './personas/sarah-cfo.js';
export { PRIYA_CMO_PERSONA } from './personas/priya-cmo.js';
export { MARCUS_DEVILS_ADVOCATE_PERSONA } from './personas/marcus-devils-advocate.js';
export type { AgentPersona } from './personas/sarah-cfo.js';

export const agent_runtimeModule: ModuleDefinition = {
  name: 'agent-runtime',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'agent-runtime' });

    // ctx.config is typed as the narrow PlatformConfig in @voai/types
    // (intentionally minimal there to avoid a circular dependency on
    // @voai/config — see module.ts). Narrow it to the concrete config
    // shape this module compiles against, same pattern routing's own
    // module registration uses.
    const config = ctx.config as unknown as PlatformConfig;

    // v1 baseline: agent-runtime constructs its own RoutingService
    // instance from the same provider config routing's module uses,
    // since there is no in-process module registry to look up another
    // module's already-constructed service by name yet. Both modules
    // call through the same `@voai/routing` typed export
    // (`RoutingService`/`AnthropicProvider`), so this is not a boundary
    // violation — it is two call sites depending on the same package.
    const provider = new AnthropicProvider(config.anthropicApiKey);
    const routingService = new RoutingService(provider, log);

    // Same narrowing pattern as identity-and-tenancy/brain's own module
    // registration: @voai/types keeps DatabaseClients loosely typed to
    // avoid a circular dependency on @voai/db.
    const postgres = ctx.db.postgres as PostgresClient;

    const router = buildAgentRuntimeRouter(routingService, log, postgres, ctx.events);

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
