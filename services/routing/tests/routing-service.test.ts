import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@voai/types';
import type { TenantContext } from '@voai/auth-context';
import { RoutingService } from '../src/routing-service.js';
import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from '../src/provider.js';

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

describe('RoutingService', () => {
  it('dispatches to the configured provider and returns its result', async () => {
    const result: LlmCompletionResult = {
      content: 'hello',
      model: 'fake-model',
      usage: { inputTokens: 1, outputTokens: 1 },
    };
    const provider: LlmProvider = { id: 'fake', complete: vi.fn().mockResolvedValue(result) };
    const logger = createFakeLogger();

    const service = new RoutingService(provider, logger);
    const actual = await service.complete(tenantContext, request);

    expect(actual).toEqual(result);
    expect(provider.complete).toHaveBeenCalledWith(request);
  });

  it('logs the routing decision and the completion outcome via the injected logger', async () => {
    const provider: LlmProvider = {
      id: 'fake',
      complete: vi.fn().mockResolvedValue({
        content: 'hello',
        model: 'fake-model',
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    };
    const logger = createFakeLogger();

    const service = new RoutingService(provider, logger);
    await service.complete(tenantContext, request);

    expect(logger.child).toHaveBeenCalledWith({
      tenantId: tenantContext.tenantId,
      userId: tenantContext.userId,
      provider: 'fake',
    });
    expect(logger.info).toHaveBeenCalledWith('routing decision', expect.objectContaining({ provider: 'fake' }));
    expect(logger.info).toHaveBeenCalledWith(
      'routing completion succeeded',
      expect.objectContaining({ provider: 'fake', model: 'fake-model' }),
    );
  });

  it('logs and rethrows when the provider fails', async () => {
    const failure = new Error('provider exploded');
    const provider: LlmProvider = { id: 'fake', complete: vi.fn().mockRejectedValue(failure) };
    const logger = createFakeLogger();

    const service = new RoutingService(provider, logger);

    await expect(service.complete(tenantContext, request)).rejects.toThrow('provider exploded');
    expect(logger.error).toHaveBeenCalledWith(
      'routing completion failed',
      expect.objectContaining({ provider: 'fake', error: 'provider exploded' }),
    );
  });
});
