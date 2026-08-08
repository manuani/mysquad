/**
 * Routing Service
 *
 * Sprint 27: four-tier LLM routing (Advanced/High/Good/OpenSource) with
 * automatic failover across Anthropic, OpenAI, and Bedrock providers.
 * Tier is selected from the tenant's subscription plan; on provider error
 * the service cascades to the next lower tier.
 */

import express from 'express';
import type { HealthStatus, ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';
import type { PlatformConfig } from '@voai/config';
import type { TenantContext } from '@voai/auth-context';
import { AnthropicProvider } from './anthropic-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { BedrockProvider } from './bedrock-provider.js';
import { RoutingService, type PlanTier } from './routing-service.js';
import { buildRoutingRouter } from './routes.js';
import type { LlmCompletionRequest, LlmCompletionResult } from './provider.js';

export type {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmMessage,
  LlmProvider,
  LlmUsage,
  ProviderTier,
  TIER_COST_MICRO_PER_1K,
} from './provider.js';
export { computeCostMicro } from './provider.js';
export { AnthropicProvider } from './anthropic-provider.js';
export { OpenAIProvider } from './openai-provider.js';
export { BedrockProvider } from './bedrock-provider.js';
export { RoutingService } from './routing-service.js';
export type { RoutingUsageEvent, OnUsageCallback, PlanTier } from './routing-service.js';

export async function routeCompletion(
  tenantContext: TenantContext,
  routingService: RoutingService,
  request: LlmCompletionRequest,
  planTier: PlanTier = 'starter',
): Promise<LlmCompletionResult> {
  return routingService.complete(tenantContext, request, planTier);
}

export const routingModule: ModuleDefinition = {
  name: 'routing',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'routing' });
    const config = ctx.config as unknown as PlatformConfig;

    // Build all available providers; each registers for its tier.
    // RoutingService picks the right tier(s) based on the tenant's plan.
    const providers = [
      // Advanced tier — Opus via Anthropic
      new AnthropicProvider(config.anthropicApiKey, 'claude-opus-4-8', 'advanced'),
      // High tier — Sonnet via Anthropic, GPT-4o via OpenAI
      new AnthropicProvider(config.anthropicApiKey, 'claude-sonnet-4-6', 'high'),
      new OpenAIProvider(process.env['OPENAI_API_KEY'], 'gpt-4o', 'high'),
      // Good tier — Haiku via Anthropic, GPT-4o-mini via OpenAI
      new AnthropicProvider(config.anthropicApiKey, 'claude-haiku-4-5-20251001', 'good'),
      new OpenAIProvider(process.env['OPENAI_API_KEY'], 'gpt-4o-mini', 'good'),
      // Opensource tier — Bedrock Llama (last-resort failover)
      new BedrockProvider(),
    ];

    const routingService = new RoutingService(providers, log);

    const router = express.Router();
    router.use('/', buildRoutingRouter(routingService));

    // Routing has no datastore; its dependencies are the LLM providers. Probing
    // them for real would mean a billable completion per health check, so this
    // reports credential availability instead — the failure mode that actually
    // bites, since an unconfigured provider throws on first use.
    //
    // Tiers fail over downward, so losing a tier is survivable; losing every
    // provider is not, and takes every AI feature with it.
    const health = (): Promise<HealthStatus> => {
      const configured = providers.filter((p) => p.isConfigured);
      if (configured.length === 0) {
        return Promise.resolve({
          status: 'unhealthy',
          reason: 'no LLM provider is configured — set ANTHROPIC_API_KEY',
        });
      }
      const missing = providers.filter((p) => !p.isConfigured);
      return Promise.resolve(
        missing.length === 0
          ? { status: 'healthy' }
          : {
              status: 'degraded',
              reason: `no failover for: ${[...new Set(missing.map((p) => p.id))].join(', ')}`,
            },
      );
    };

    router.get('/healthz', async (_req, res) => {
      const status = await health();
      res.status(status.status === 'unhealthy' ? 503 : 200).json({
        module: 'routing',
        ...status,
        providers: providers.map((p) => ({ id: p.id, tier: p.tier, configured: p.isConfigured })),
      });
    });

    log.info('module registered', { providerCount: providers.length });

    return {
      name: 'routing',
      router,
      health,
      shutdown: async () => {
        log.info('module shutdown');
      },
    };
  },
};

export default routingModule;
