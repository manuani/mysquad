/**
 * Tier selection: the plan is a ceiling, the task's complexity picks within it.
 *
 * Before this, dispatch keyed on the billing plan alone and nothing ever passed
 * a plan — so every tenant ran at the 'starter' default and the advanced/high
 * providers registered at boot were unreachable.
 */

import { describe, expect, it, vi } from 'vitest';
import { RoutingService } from '../src/routing-service.js';
import type { LlmProvider, ProviderTier } from '../src/provider.js';
import type { TenantContext } from '@voai/auth-context';

const TC: TenantContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  userType: 'founder',
  sessionId: 'session-1',
};

const noopLogger = {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  child: vi.fn(() => noopLogger),
} as never;

function provider(id: string, tier: ProviderTier, opts: { configured?: boolean; fails?: boolean } = {}): LlmProvider {
  return {
    id,
    tier,
    isConfigured: opts.configured ?? true,
    complete: vi.fn(async () => {
      if (opts.fails) throw new Error(`${id} is down`);
      return {
        content: 'ok',
        model: `${id}-model`,
        usage: { inputTokens: 10, outputTokens: 5 },
        totalCostMicro: 1,
        tier,
      };
    }),
  };
}

/** One provider per tier, all healthy. */
function fullStack(): LlmProvider[] {
  return [
    provider('anthropic-opus', 'advanced'),
    provider('anthropic-sonnet', 'high'),
    provider('anthropic-haiku', 'good'),
    provider('bedrock', 'opensource'),
  ];
}

const request = { systemPrompt: 'sys', messages: [{ role: 'user' as const, content: 'hi' }] };

describe('tier selection', () => {
  it('uses the advanced tier for a complex question on an enterprise plan', async () => {
    const svc = new RoutingService(fullStack(), noopLogger);
    const result = await svc.complete(TC, request, 'enterprise', {
      message: 'Should we cut marketing or raise a bridge round?',
    });
    expect(result.tier).toBe('advanced');
  });

  it('drops to the good tier for a routine question, even on enterprise', async () => {
    // The saving this whole change exists for: an enterprise tenant asking what
    // a term means should not be billed at Opus rates.
    const svc = new RoutingService(fullStack(), noopLogger);
    const result = await svc.complete(TC, request, 'enterprise', { message: 'What is ARR?' });
    expect(result.tier).toBe('good');
  });

  it('never exceeds the plan ceiling, however hard the question', async () => {
    const svc = new RoutingService(fullStack(), noopLogger);
    const result = await svc.complete(TC, request, 'starter', {
      message: 'Should we raise a bridge round at a $40M valuation or restructure?',
    });
    expect(result.tier).toBe('good');
  });

  it('caps a growth plan at the high tier', async () => {
    const svc = new RoutingService(fullStack(), noopLogger);
    const result = await svc.complete(TC, request, 'growth', {
      message: 'Should we cut marketing or raise a bridge round?',
    });
    expect(result.tier).toBe('high');
  });

  it('uses the plan ceiling when no task is supplied', async () => {
    // Callers that pass no task keep the previous behaviour.
    const svc = new RoutingService(fullStack(), noopLogger);
    const result = await svc.complete(TC, request, 'enterprise');
    expect(result.tier).toBe('advanced');
  });

  it('falls back to starter when no plan is given', async () => {
    const svc = new RoutingService(fullStack(), noopLogger);
    const result = await svc.complete(TC, request);
    expect(result.tier).toBe('good');
  });

  describe('provider independence', () => {
    it('serves every tier from a single vendor', async () => {
      // "Platform agnostic" must mean one provider covering all tiers is a
      // complete configuration, not a degraded one.
      const anthropicOnly = [
        provider('anthropic-opus', 'advanced'),
        provider('anthropic-sonnet', 'high'),
        provider('anthropic-haiku', 'good'),
      ];
      const svc = new RoutingService(anthropicOnly, noopLogger);
      const result = await svc.complete(TC, request, 'enterprise', {
        message: 'Should we cut marketing or raise a bridge round?',
      });
      expect(result.model).toBe('anthropic-opus-model');
    });

    it('skips unconfigured providers instead of calling them', async () => {
      const unconfigured = provider('openai', 'high', { configured: false });
      const anthropic = provider('anthropic-sonnet', 'high');
      const svc = new RoutingService([unconfigured, anthropic], noopLogger);

      const result = await svc.complete(TC, request, 'growth', { message: 'anything' });

      expect(unconfigured.complete).not.toHaveBeenCalled();
      expect(result.model).toBe('anthropic-sonnet-model');
    });

    it('fails over to the next provider in the same tier', async () => {
      const failing = provider('anthropic-sonnet', 'high', { fails: true });
      const backup = provider('openai-gpt4o', 'high');
      const svc = new RoutingService([failing, backup], noopLogger);

      const result = await svc.complete(TC, request, 'growth', { message: 'anything' });
      expect(result.model).toBe('openai-gpt4o-model');
    });

    it('cascades to a lower tier when a whole tier is down', async () => {
      const svc = new RoutingService(
        [provider('sonnet', 'high', { fails: true }), provider('haiku', 'good')],
        noopLogger,
      );
      const result = await svc.complete(TC, request, 'growth', { message: 'anything' });
      expect(result.tier).toBe('good');
    });

    it('never fails over upward past the selected tier', async () => {
      // A routine question that fails at 'good' must not silently escalate to
      // Opus — that would make the cheap path the expensive one on any blip.
      const opus = provider('opus', 'advanced');
      const svc = new RoutingService(
        [opus, provider('haiku', 'good', { fails: true }), provider('bedrock', 'opensource')],
        noopLogger,
      );

      const result = await svc.complete(TC, request, 'enterprise', { message: 'What is ARR?' });

      expect(opus.complete).not.toHaveBeenCalled();
      expect(result.tier).toBe('opensource');
    });

    it('throws with every provider error when all are exhausted', async () => {
      const svc = new RoutingService(
        [provider('haiku', 'good', { fails: true }), provider('bedrock', 'opensource', { fails: true })],
        noopLogger,
      );
      await expect(svc.complete(TC, request, 'starter', { message: 'x' })).rejects.toThrow(/haiku is down/);
    });
  });
});
