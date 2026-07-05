/**
 * AWS Bedrock implementation of LlmProvider (Llama 3 via the converse API).
 *
 * Tier: opensource — cheapest tier, used as:
 *   1. The default for the opensource tier in the 4-tier classification
 *   2. The last-resort failover when all other providers error
 *
 * Uses existing AWS credentials from environment (same as ECS task role).
 * Graceful degradation: missing region or model ID → PROVIDER_UNAVAILABLE.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';
import { PlatformError } from '@voai/errors';
import type {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmProvider,
  ProviderTier,
} from './provider.js';
import { computeCostMicro } from './provider.js';

const DEFAULT_MODEL_ID = 'meta.llama3-8b-instruct-v1:0';
const DEFAULT_REGION = 'ap-south-1';

export class BedrockProvider implements LlmProvider {
  readonly id = 'bedrock';
  readonly tier: ProviderTier = 'opensource';

  private readonly modelId: string;
  private readonly region: string;

  constructor(
    modelId: string = process.env['BEDROCK_MODEL_ID'] ?? DEFAULT_MODEL_ID,
    region: string = process.env['AWS_REGION'] ?? DEFAULT_REGION,
  ) {
    this.modelId = modelId;
    this.region = region;
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const client = new BedrockRuntimeClient({ region: this.region });

    const messages: Message[] = request.messages.map((m) => ({
      role: m.role,
      content: [{ text: m.content }],
    }));

    let response;
    try {
      response = await client.send(
        new ConverseCommand({
          modelId: this.modelId,
          system: [{ text: request.systemPrompt }],
          messages,
          inferenceConfig: { maxTokens: request.maxTokens ?? 1024 },
        }),
      );
    } catch (err) {
      throw new PlatformError(
        'PROVIDER_UNAVAILABLE',
        503,
        `Bedrock provider error: ${err instanceof Error ? err.message : String(err)}`,
        { provider: this.id, modelId: this.modelId },
      );
    }

    const content =
      response.output?.message?.content
        ?.filter((b) => b.text !== undefined)
        .map((b) => b.text ?? '')
        .join('') ?? '';

    const inputTokens = response.usage?.inputTokens ?? 0;
    const outputTokens = response.usage?.outputTokens ?? 0;

    return {
      content,
      model: this.modelId,
      tier: this.tier,
      usage: { inputTokens, outputTokens },
      totalCostMicro: computeCostMicro(inputTokens, outputTokens, this.tier),
    };
  }
}
