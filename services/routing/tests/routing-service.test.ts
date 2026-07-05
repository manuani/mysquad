import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@voai/types';
import type { TenantContext } from '@voai/auth-context';
import { RoutingService } from '../src/routing-service.js';
import type {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmProvider,
  ProviderTier,
} from '../src/provider.js';

function createFakeLogger(): Logger {
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => logger),
  };
  return logger;
}

const tenantContext: TenantContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  userType: 'founder',
  sessionId: 'session-1',
};

const request: LlmCompletionRequest = {
  systemPrompt: 'sys',
  messages: [{ role: 'user', content: 'hi' }],
};

function fakeProvider(
  id: string,
  tier: ProviderTier,
  result: Partial<LlmCompletionResult> | Error,
): LlmProvider {
  const base: LlmCompletionResult = {
    content: 'hello',
    model: `${id}-model`,
    tier,
    usage: { inputTokens: 10, outputTokens: 5 },
    totalCostMicro: 100,
  };
  return {
    id,
    tier,
    complete:
      result instanceof Error
        ? vi.fn().mockRejectedValue(result)
        : vi.fn().mockResolvedValue({ ...base, ...result }),
  };
}

describe('RoutingService — tier selection', () => {
  it('selects good tier for starter plan', async () => {
    const good = fakeProvider('good-p', 'good', {});
    const high = fakeProvider('high-p', 'high', {});
    const service = new RoutingService([good, high], createFakeLogger());

    const result = await service.complete(tenantContext, request, 'starter');
    expect(good.complete as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
    expect(high.complete as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(result.tier).toBe('good');
  });

  it('selects high tier for growth plan', async () => {
    const good = fakeProvider('good-p', 'good', {});
    const high = fakeProvider('high-p', 'high', {});
    const service = new RoutingService([good, high], createFakeLogger());

    await service.complete(tenantContext, request, 'growth');
    expect(high.complete as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
    expect(good.complete as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('selects advanced tier for enterprise plan', async () => {
    const advanced = fakeProvider('adv-p', 'advanced', {});
    const high = fakeProvider('high-p', 'high', {});
    const service = new RoutingService([advanced, high], createFakeLogger());

    await service.complete(tenantContext, request, 'enterprise');
    expect(advanced.complete as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
    expect(high.complete as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});

describe('RoutingService — failover', () => {
  it('falls back to next provider in same tier on error', async () => {
    const p1 = fakeProvider('p1', 'good', new Error('p1 down'));
    const p2 = fakeProvider('p2', 'good', { content: 'from p2' });
    const service = new RoutingService([p1, p2], createFakeLogger());

    const result = await service.complete(tenantContext, request, 'starter');
    expect(result.content).toBe('from p2');
  });

  it('cascades to next lower tier when all providers in chosen tier fail', async () => {
    const highFail = fakeProvider('high-fail', 'high', new Error('high down'));
    const good = fakeProvider('good-ok', 'good', { content: 'good tier response' });
    const service = new RoutingService([highFail, good], createFakeLogger());

    const result = await service.complete(tenantContext, request, 'growth');
    expect(result.content).toBe('good tier response');
  });

  it('throws when all tiers and all providers exhausted', async () => {
    const fail1 = fakeProvider('f1', 'good', new Error('down'));
    const fail2 = fakeProvider('f2', 'opensource', new Error('also down'));
    const service = new RoutingService([fail1, fail2], createFakeLogger());

    await expect(service.complete(tenantContext, request, 'starter')).rejects.toThrow(
      /All LLM providers failed/,
    );
  });
});

describe('RoutingService — usage callback', () => {
  it('fires onUsage with cost info after success', async () => {
    const provider = fakeProvider('p', 'high', { totalCostMicro: 42, model: 'test-model' });
    const onUsage = vi.fn();
    const service = new RoutingService([provider], createFakeLogger(), onUsage);

    await service.complete(tenantContext, request, 'growth');
    await Promise.resolve();

    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'p',
        providerTier: 'high',
        totalCostMicro: 42,
        model: 'test-model',
        sessionId: 'session-1',
      }),
    );
  });

  it('does not fire onUsage when all providers fail', async () => {
    const provider = fakeProvider('p', 'good', new Error('fail'));
    const onUsage = vi.fn();
    const service = new RoutingService([provider], createFakeLogger(), onUsage);

    await expect(service.complete(tenantContext, request, 'starter')).rejects.toThrow();
    await Promise.resolve();
    expect(onUsage).not.toHaveBeenCalled();
  });
});

describe('computeCostMicro', () => {
  it('computes cost proportionally to token count and tier', async () => {
    const { computeCostMicro, TIER_COST_MICRO_PER_1K } = await import('../src/provider.js');
    // 1000 total tokens at good tier
    expect(computeCostMicro(500, 500, 'good')).toBe(TIER_COST_MICRO_PER_1K['good']);
    // 500 tokens at advanced tier = half of cost_per_1k
    expect(computeCostMicro(250, 250, 'advanced')).toBe(
      Math.round(TIER_COST_MICRO_PER_1K['advanced'] / 2),
    );
  });
});
