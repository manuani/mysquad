/**
 * OpenAI implementation of LlmProvider.
 *
 * Tier mapping:
 *   gpt-4o       → high  (growth plan default)
 *   gpt-4o-mini  → good  (starter plan)
 *
 * Graceful degradation: no key → PROVIDER_UNAVAILABLE on first call,
 * same as AnthropicProvider.
 */

import OpenAI from 'openai';
import { PlatformError } from '@voai/errors';
import type {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmProvider,
  ProviderTier,
} from './provider.js';
import { computeCostMicro } from './provider.js';

export class OpenAIProvider implements LlmProvider {
  readonly id = 'openai';
  readonly tier: ProviderTier;

  private readonly apiKey: string | undefined;
  private readonly model: string;

  constructor(apiKey: string | undefined, model = 'gpt-4o-mini', tier: ProviderTier = 'good') {
    this.apiKey = apiKey;
    this.model = model;
    this.tier = tier;
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    if (!this.apiKey) {
      throw new PlatformError(
        'PROVIDER_UNAVAILABLE',
        503,
        'OpenAI provider has no API key configured (OPENAI_API_KEY unset).',
        { provider: this.id },
      );
    }

    const client = new OpenAI({
      apiKey: this.apiKey,
      defaultHeaders: request.requestId ? { 'x-request-id': request.requestId } : {},
    });

    const response = await client.chat.completions.create({
      model: this.model,
      max_tokens: request.maxTokens ?? 1024,
      messages: [
        { role: 'system', content: request.systemPrompt },
        ...request.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });

    const choice = response.choices[0];
    if (!choice) throw new PlatformError('PROVIDER_UNAVAILABLE', 502, 'OpenAI returned no choices');

    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;

    return {
      content: choice.message.content ?? '',
      model: response.model,
      tier: this.tier,
      usage: { inputTokens, outputTokens },
      totalCostMicro: computeCostMicro(inputTokens, outputTokens, this.tier),
    };
  }
}
