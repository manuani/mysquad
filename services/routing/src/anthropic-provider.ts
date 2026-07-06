/**
 * Anthropic implementation of `LlmProvider` (the v1 baseline provider).
 *
 * Reads its API key from configuration handed in at construction time
 * (`ModuleContext.config.anthropicApiKey`, per `@voai/config`) — never from
 * `process.env` directly, matching the platform convention that modules
 * receive their config slice rather than instantiate it.
 *
 * No real Anthropic credential is available in this development
 * environment (mirrors the gap `identity-and-tenancy` documented for
 * WorkOS — see its README's "Deferred" section). A missing key must not
 * crash the module at boot/registration time, since `anthropicApiKey` is
 * optional in `PlatformConfigSchema` and the module must still register and
 * report healthy with no key configured. Instead, the failure surfaces the
 * first time `complete()` is actually invoked, as a clear
 * `PROVIDER_UNAVAILABLE` error rather than an SDK stack trace.
 */

import Anthropic from '@anthropic-ai/sdk';
import { PlatformError } from '@voai/errors';
import type {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmProvider,
  ProviderTier,
} from './provider.js';
import { computeCostMicro } from './provider.js';

const DEFAULT_MODEL = 'claude-sonnet-4-5';
const DEFAULT_MAX_TOKENS = 1024;

export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic';
  readonly tier: ProviderTier;

  private readonly apiKey: string | undefined;
  private readonly model: string;

  constructor(
    apiKey: string | undefined,
    model: string = DEFAULT_MODEL,
    tier: ProviderTier = 'high',
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.tier = tier;
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    if (!this.apiKey) {
      throw new PlatformError(
        'PROVIDER_UNAVAILABLE',
        503,
        'Anthropic provider has no API key configured (ANTHROPIC_API_KEY unset). ' +
          'This is expected in this development environment; configure the key to ' +
          'exercise real completions.',
        { provider: this.id },
      );
    }

    const headers: Record<string, string> = {};
    if (request.requestId) headers['x-request-id'] = request.requestId;

    const client = new Anthropic({ apiKey: this.apiKey, defaultHeaders: headers });

    const response = await client.messages.create({
      model: this.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: request.systemPrompt,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const content = response.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('');

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    return {
      content,
      model: response.model,
      tier: this.tier,
      usage: { inputTokens, outputTokens },
      totalCostMicro: computeCostMicro(inputTokens, outputTokens, this.tier),
    };
  }
}
