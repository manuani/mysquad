import { describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '@voai/auth-context';
import type { LlmCompletionRequest, LlmCompletionResult, RoutingService } from '@voai/routing';
import { AgentRuntime } from '../src/agent-runtime.js';
import { SARAH_CFO_PERSONA } from '../src/personas/sarah-cfo.js';

const TENANT_CONTEXT: TenantContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  userType: 'founder',
  sessionId: 'session-1',
};

function makeFakeRoutingService(
  completeImpl: (request: LlmCompletionRequest) => Promise<LlmCompletionResult>,
): RoutingService {
  return {
    complete: vi.fn(async (_tenantContext: TenantContext, request: LlmCompletionRequest) =>
      completeImpl(request),
    ),
  } as unknown as RoutingService;
}

describe('AgentRuntime', () => {
  it('assembles the persona system prompt and message history into the routing request', async () => {
    let capturedRequest: LlmCompletionRequest | undefined;
    const routingService = makeFakeRoutingService(async (request) => {
      capturedRequest = request;
      return {
        content: "Let's look at your runway numbers.",
        model: 'fake-model',
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    });

    const runtime = new AgentRuntime(routingService);
    await runtime.generateContribution(TENANT_CONTEXT, SARAH_CFO_PERSONA, {
      message: 'How much runway do we have left?',
      priorTurns: [
        { role: 'user', content: 'Hi Sarah' },
        { role: 'assistant', content: 'Hello! How can I help with your finances today?' },
      ],
    });

    expect(capturedRequest).toBeDefined();
    expect(capturedRequest?.systemPrompt).toBe(SARAH_CFO_PERSONA.systemPrompt);
    expect(capturedRequest?.systemPrompt).toContain('Sarah Chen');
    expect(capturedRequest?.systemPrompt).toContain('warm');
    expect(capturedRequest?.messages).toEqual([
      { role: 'user', content: 'Hi Sarah' },
      { role: 'assistant', content: 'Hello! How can I help with your finances today?' },
      { role: 'user', content: 'How much runway do we have left?' },
    ]);
  });

  it('passes tenantContext through to the routing service as the first argument', async () => {
    const routingService = makeFakeRoutingService(async () => ({
      content: 'ok',
      model: 'fake-model',
      usage: { inputTokens: 1, outputTokens: 1 },
    }));

    const runtime = new AgentRuntime(routingService);
    await runtime.generateContribution(TENANT_CONTEXT, SARAH_CFO_PERSONA, { message: 'hi' });

    expect(routingService.complete).toHaveBeenCalledWith(
      TENANT_CONTEXT,
      expect.objectContaining({ systemPrompt: SARAH_CFO_PERSONA.systemPrompt }),
    );
  });

  it('shapes the routing result into an AgentContribution', async () => {
    const routingService = makeFakeRoutingService(async () => ({
      content: 'Your burn multiple looks healthy this quarter.',
      model: 'fake-model',
      usage: { inputTokens: 20, outputTokens: 12 },
    }));

    const runtime = new AgentRuntime(routingService);
    const contribution = await runtime.generateContribution(TENANT_CONTEXT, SARAH_CFO_PERSONA, {
      message: 'How is our burn multiple?',
    });

    expect(contribution.agentName).toBe('Sarah Chen');
    expect(contribution.content).toBe('Your burn multiple looks healthy this quarter.');
    expect(() => new Date(contribution.generatedAt)).not.toThrow();
    expect(Number.isNaN(new Date(contribution.generatedAt).getTime())).toBe(false);
  });

  it('omits priorTurns from the message list when not provided', async () => {
    let capturedRequest: LlmCompletionRequest | undefined;
    const routingService = makeFakeRoutingService(async (request) => {
      capturedRequest = request;
      return { content: 'ok', model: 'fake-model', usage: { inputTokens: 1, outputTokens: 1 } };
    });

    const runtime = new AgentRuntime(routingService);
    await runtime.generateContribution(TENANT_CONTEXT, SARAH_CFO_PERSONA, { message: 'just one message' });

    expect(capturedRequest?.messages).toEqual([{ role: 'user', content: 'just one message' }]);
  });
});
