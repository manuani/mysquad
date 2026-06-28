/**
 * RoutingService — the single seam every LLM call passes through.
 *
 * v1 baseline (Sprint 2.1.2): one configured provider, selected at
 * construction time. Every call is logged as a routing decision via the
 * module's `Logger` — per System Architecture, routing decisions are
 * recorded, but a persisted `routing_decisions` table has billing
 * implications best left to a later sprint with a clear migration owner
 * (see README "Deferred"); for v1 the decision log is structured log
 * output only.
 *
 * Per ADR 007, `tenantContext` is the first parameter of every call —
 * there is no ambient context to read instead.
 */

import type { Logger } from '@voai/types';
import type { TenantContext } from '@voai/auth-context';
import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from './provider.js';

export class RoutingService {
  private readonly provider: LlmProvider;
  private readonly logger: Logger;

  /**
   * `provider` is the single dispatch target for v1. Phase 5 introduces
   * four-tier classification and multi-provider selection; that work
   * replaces this single `provider` field with a selection function over a
   * registry of providers — call sites in this class do not need to change
   * shape for that to land, since they already go through `this.provider`
   * rather than branching on provider identity.
   */
  constructor(provider: LlmProvider, logger: Logger) {
    this.provider = provider;
    this.logger = logger;
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
