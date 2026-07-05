/**
 * RoutingService — four-tier LLM dispatcher with automatic failover.
 *
 * Tier selection (Sprint 27):
 *   enterprise → advanced tier  (Claude Opus or equivalent)
 *   growth     → high tier      (Claude Sonnet / GPT-4o)
 *   starter    → good tier      (Claude Haiku / GPT-4o-mini)
 *   (any)      → opensource     (Bedrock Llama — last-resort failover)
 *
 * Each tier holds an ordered list of providers. On error the service tries
 * the next provider in the list. If all providers in the chosen tier fail,
 * it cascades to the next lower tier, then to opensource. This means the
 * system always produces a response rather than a hard failure.
 *
 * Cost tracking: totalCostMicro from the result is included in the
 * RoutingUsageEvent so metering can record it without RoutingService needing
 * a DB dependency.
 *
 * Per ADR 007, tenantContext is the first parameter of every call.
 */

import type { Logger } from '@voai/types';
import type { TenantContext } from '@voai/auth-context';
import type {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmProvider,
  ProviderTier,
} from './provider.js';

export type PlanTier = 'starter' | 'growth' | 'enterprise';

const PLAN_TO_TIERS: Record<PlanTier, ProviderTier[]> = {
  enterprise: ['advanced', 'high', 'good', 'opensource'],
  growth: ['high', 'good', 'opensource'],
  starter: ['good', 'opensource'],
};

export interface RoutingUsageEvent {
  readonly tenantContext: TenantContext;
  readonly model: string;
  readonly providerTier: ProviderTier;
  readonly providerId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalCostMicro: number;
  readonly sessionId?: string;
}

export type OnUsageCallback = (event: RoutingUsageEvent) => void | Promise<void>;

export class RoutingService {
  /** providers grouped by tier, each sub-array in priority order */
  private readonly tierMap: Map<ProviderTier, LlmProvider[]>;
  private readonly logger: Logger;
  private readonly onUsage: OnUsageCallback | undefined;

  constructor(providers: LlmProvider[], logger: Logger, onUsage?: OnUsageCallback) {
    this.logger = logger;
    this.onUsage = onUsage;
    this.tierMap = new Map();
    for (const p of providers) {
      const list = this.tierMap.get(p.tier) ?? [];
      list.push(p);
      this.tierMap.set(p.tier, list);
    }
  }

  async complete(
    tenantContext: TenantContext,
    request: LlmCompletionRequest,
    planTier: PlanTier = 'starter',
  ): Promise<LlmCompletionResult> {
    const log = this.logger.child({ tenantId: tenantContext.tenantId, plan: planTier });
    const tierSequence = PLAN_TO_TIERS[planTier];

    const errors: Array<{ provider: string; err: string }> = [];

    for (const tier of tierSequence) {
      const providers = this.tierMap.get(tier) ?? [];
      for (const provider of providers) {
        log.info('routing attempt', { provider: provider.id, tier });
        try {
          const result = await provider.complete(request);
          log.info('routing success', {
            provider: provider.id,
            tier,
            model: result.model,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            totalCostMicro: result.totalCostMicro,
          });
          this.fireUsage(tenantContext, result, provider.id);
          return result;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn('provider failed, trying next', { provider: provider.id, tier, err: msg });
          errors.push({ provider: provider.id, err: msg });
        }
      }
    }

    log.error('all providers exhausted', { errors });
    throw new Error(
      `All LLM providers failed for plan=${planTier}: ${errors.map((e) => `${e.provider}: ${e.err}`).join('; ')}`,
    );
  }

  private fireUsage(
    tenantContext: TenantContext,
    result: LlmCompletionResult,
    providerId: string,
  ): void {
    if (!this.onUsage) return;
    Promise.resolve(
      this.onUsage({
        tenantContext,
        model: result.model,
        providerTier: result.tier,
        providerId,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalCostMicro: result.totalCostMicro,
        sessionId: tenantContext.sessionId ?? undefined,
      }),
    ).catch((err: unknown) => {
      this.logger.warn('metering callback error (non-blocking)', { err: String(err) });
    });
  }
}
