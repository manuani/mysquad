/**
 * Routing Service
 *
 * All LLM calls dispatch through here. v1 baseline: single provider
 * (Anthropic), with the abstraction in place so adding a provider later is
 * a configuration change, not a code change (`LlmProvider` in
 * `provider.ts`, `AnthropicProvider` in `anthropic-provider.ts`). Phase 5
 * expands to four-tier classification (Advanced/High/Good/OpenSource)
 * across 5-7 providers with subscription-tier-driven routing and failover
 * — out of scope here.
 *
 * Sprint reference: Phase 2, Sprint 2.1.2; Phase 5, Sprint 5.1
 */

import express from 'express';
import type { ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';
import type { PlatformConfig } from '@voai/config';
import type { TenantContext } from '@voai/auth-context';
import { AnthropicProvider } from './anthropic-provider.js';
import { RoutingService } from './routing-service.js';
import { buildRoutingRouter } from './routes.js';
import type { LlmCompletionRequest, LlmCompletionResult } from './provider.js';

export type { LlmCompletionRequest, LlmCompletionResult, LlmMessage, LlmProvider, LlmUsage } from './provider.js';
export { AnthropicProvider } from './anthropic-provider.js';
export { RoutingService } from './routing-service.js';
export type { RoutingUsageEvent, OnUsageCallback } from './routing-service.js';

/**
 * Typed cross-module entry point, mirroring the pattern in
 * `services/identity-and-tenancy/src/index.ts`: another module (e.g.
 * `agent-runtime`) can either call the HTTP route or, if it ends up
 * calling in-process, import this function directly instead of reaching
 * into `routing-service.ts`/`provider.ts` internals.
 */
export async function routeCompletion(
  tenantContext: TenantContext,
  routingService: RoutingService,
  request: LlmCompletionRequest,
): Promise<LlmCompletionResult> {
  return routingService.complete(tenantContext, request);
}

export const routingModule: ModuleDefinition = {
  name: 'routing',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'routing' });

    // ctx.config is typed as the narrow PlatformConfig in @voai/types
    // (intentionally minimal there to avoid a circular dependency on
    // @voai/config — see module.ts). Narrow it to the concrete config
    // shape this module compiles against, same pattern
    // identity-and-tenancy uses for ctx.db.postgres.
    const config = ctx.config as unknown as PlatformConfig;

    // v1 baseline: single provider, selected purely by configuration.
    // Adding a second provider later means constructing it here behind a
    // config-driven switch (e.g. config.llmProvider) — RoutingService
    // and the HTTP/typed call sites do not change.
    const provider = new AnthropicProvider(config.anthropicApiKey);
    const routingService = new RoutingService(provider, log);

    const router = express.Router();
    router.use('/', buildRoutingRouter(routingService));

    router.get('/healthz', (_req, res) => {
      res.json({ module: 'routing', status: 'healthy' });
    });

    log.info('module registered', { provider: provider.id });

    return {
      name: 'routing',
      router,
      health: async () => ({ status: 'healthy' }),
      shutdown: async () => {
        log.info('module shutdown');
      },
    };
  },
};

export default routingModule;
