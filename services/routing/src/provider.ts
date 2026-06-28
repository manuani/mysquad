/**
 * The provider seam every LLM call passes through.
 *
 * Per System Architecture and Sprint Plan Deliverable 2.1.2: at v1 baseline
 * the routing service dispatches everything to a single provider
 * (Anthropic), but the abstraction is built so adding a second provider
 * later is a configuration change, not a code change. Any concrete
 * provider (Anthropic now; OpenAI, Bedrock, etc. in Phase 5) implements
 * this interface and is selected purely by configuration — `RoutingService`
 * never branches on provider identity in its call sites.
 */

export interface LlmMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface LlmCompletionRequest {
  readonly systemPrompt: string;
  readonly messages: readonly LlmMessage[];
  readonly maxTokens?: number;
}

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface LlmCompletionResult {
  readonly content: string;
  readonly model: string;
  readonly usage: LlmUsage;
}

/**
 * Implemented by every concrete LLM provider. `RoutingService` depends only
 * on this interface, never on a concrete provider class, so swapping or
 * adding providers is a registration/config change.
 */
export interface LlmProvider {
  /** Stable identifier used in routing-decision logs (e.g. 'anthropic'). */
  readonly id: string;
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}
