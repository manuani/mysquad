/**
 * RoutingService — the single seam every LLM call passes through.
 *
 * v1 baseline (Sprint 2.1.2): one configured provider, selected at
 * construction time. Every call is logged as a routing decision via the
 * module's `Logger`.
 *
 * Sprint 13: optional `onUsage` callback fires after every successful
 * completion so callers can record a metering event without RoutingService
 * needing a database dependency.
 *
 * Per ADR 007, `tenantContext` is the first parameter of every call —
 * there is no ambient context to read instead.
 */

import type { Logger } from '@voai/types';
import type { TenantContext } from '@voai/auth-context';
import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from './provider.js';

export interface RoutingUsageEvent {
  readonly tenantContext: TenantContext;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly sessionId?: string;
}

export type OnUsageCallback = (event: RoutingUsageEvent) => void | Promise<void>;

export class RoutingService {
  private readonly provider: LlmProvider;
  private readonly logger: Logger;
  private readonly onUsage: OnUsageCallback | undefined;

  constructor(provider: LlmProvider, logger: Logger, onUsage?: OnUsageCallback) {
    this.provider = provider;
    this.logger = logger;
    this.onUsage = onUsage;
  }

  async complete(
    tenantContext: TenantContext,
    request: LlmCompletionRequest,
  ): Promise<LlmCompletionResult> {
    const log = this.logger.child({
      tenantId: tenantContext.tenantId,
      userId: tenantContext.userId,
      provider: this.provider.id,
    });

    log.info('routing decision', {
      provider: this.provider.id,
      messageCount: request.messages.length,
      maxTokens: request.maxTokens,
    });

    try {
      const result = await this.provider.complete(request);
      log.info('routing completion succeeded', {
        provider: this.provider.id,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });

      if (this.onUsage) {
        Promise.resolve(
          this.onUsage({
            tenantContext,
            model: result.model,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            sessionId: tenantContext.sessionId ?? undefined,
          }),
        ).catch((err: unknown) => {
          log.warn('metering callback error (non-blocking)', { err: String(err) });
        });
      }

      return result;
    } catch (err) {
      log.error('routing completion failed', {
        provider: this.provider.id,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}
