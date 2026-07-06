/**
 * The provider seam every LLM call passes through.
 *
 * Sprint 27 additions:
 *   - ProviderTier: four tiers keyed by subscription plan
 *   - TIER_COST_MICRO_PER_1K: unit cost per 1 K tokens per tier (USD × 10⁻⁶)
 *   - LlmProvider.tier: the tier this provider covers
 *   - LlmCompletionResult.unitCostMicro: cost of this call in micros
 *
 * Per System Architecture and Sprint Plan Deliverable 2.1.2: at v1 baseline
 * the routing service dispatches everything to a single provider
 * (Anthropic), but the abstraction is built so adding a second provider
 * later is a configuration change, not a code change. Any concrete
 * provider (Anthropic now; OpenAI, Bedrock, etc. in Phase 5) implements
 * this interface and is selected purely by configuration — `RoutingService`
 * never branches on provider identity in its call sites.
 */

/**
 * Four tiers, subscription-driven:
 *   advanced    — Claude Opus (enterprise plan)
 *   high        — Claude Sonnet / GPT-4o (growth plan)
 *   good        — Claude Haiku / GPT-4o-mini (starter plan)
 *   opensource  — Bedrock Llama (fallback / cost cap)
 */
export type ProviderTier = 'advanced' | 'high' | 'good' | 'opensource';

/** USD × 10⁻⁶ per 1 000 tokens for each tier (input + output blended estimate) */
export const TIER_COST_MICRO_PER_1K: Record<ProviderTier, number> = {
  advanced: 15_000, // ~$15/1K tokens (Opus)
  high: 3_000, // ~$3/1K tokens  (Sonnet / GPT-4o)
  good: 250, // ~$0.25/1K tokens (Haiku / GPT-4o-mini)
  opensource: 50, // ~$0.05/1K tokens (Bedrock Llama)
};

export interface LlmMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface LlmCompletionRequest {
  readonly systemPrompt: string;
  readonly messages: readonly LlmMessage[];
  readonly maxTokens?: number;
  /** Propagated as X-Request-Id on outbound provider calls for end-to-end tracing. */
  readonly requestId?: string;
}

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface LlmCompletionResult {
  readonly content: string;
  readonly model: string;
  readonly usage: LlmUsage;
  /** Total cost in USD × 10⁻⁶ for this call */
  readonly totalCostMicro: number;
  readonly tier: ProviderTier;
}

/**
 * Implemented by every concrete LLM provider. `RoutingService` depends only
 * on this interface, never on a concrete provider class, so swapping or
 * adding providers is a registration/config change.
 */
export interface LlmProvider {
  /** Stable identifier used in routing-decision logs (e.g. 'anthropic'). */
  readonly id: string;
  readonly tier: ProviderTier;
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}

/** Compute total cost micros from token counts and tier */
export function computeCostMicro(
  inputTokens: number,
  outputTokens: number,
  tier: ProviderTier,
): number {
  return Math.round(((inputTokens + outputTokens) * TIER_COST_MICRO_PER_1K[tier]) / 1000);
}
