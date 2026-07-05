import { describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '@voai/auth-context';
import type { LlmCompletionRequest, LlmCompletionResult, RoutingService } from '@voai/routing';
import { AgentRuntime } from '../src/agent-runtime.js';
import { SARAH_CFO_PERSONA } from '../src/personas/sarah-cfo.js';
import { PRIYA_CMO_PERSONA } from '../src/personas/priya-cmo.js';
import { MARCUS_DEVILS_ADVOCATE_PERSONA } from '../src/personas/marcus-devils-advocate.js';

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
    await runtime.generateContribution(TENANT_CONTEXT, SARAH_CFO_PERSONA, {
      message: 'just one message',
    });

    expect(capturedRequest?.messages).toEqual([{ role: 'user', content: 'just one message' }]);
  });

  it('injects brainContext into the system prompt when provided', async () => {
    let capturedRequest: LlmCompletionRequest | undefined;
    const routingService = makeFakeRoutingService(async (request) => {
      capturedRequest = request;
      return { content: 'ok', model: 'fake-model', usage: { inputTokens: 1, outputTokens: 1 } };
    });

    const runtime = new AgentRuntime(routingService);
    await runtime.generateContribution(TENANT_CONTEXT, SARAH_CFO_PERSONA, {
      message: 'How is runway looking?',
      brainContext: [
        '[financial_state] Burn rate is $80k/month',
        '[company_profile] B2B SaaS, founded 2024',
      ],
    });

    expect(capturedRequest?.systemPrompt).toContain(SARAH_CFO_PERSONA.systemPrompt);
    expect(capturedRequest?.systemPrompt).toContain('Burn rate is $80k/month');
    expect(capturedRequest?.systemPrompt).toContain('B2B SaaS, founded 2024');
    expect(capturedRequest?.systemPrompt).toContain('colleague with continuity');
  });

  it('does not alter the system prompt when brainContext is empty or omitted', async () => {
    let capturedRequest: LlmCompletionRequest | undefined;
    const routingService = makeFakeRoutingService(async (request) => {
      capturedRequest = request;
      return { content: 'ok', model: 'fake-model', usage: { inputTokens: 1, outputTokens: 1 } };
    });

    const runtime = new AgentRuntime(routingService);
    await runtime.generateContribution(TENANT_CONTEXT, SARAH_CFO_PERSONA, {
      message: 'hi',
      brainContext: [],
    });

    expect(capturedRequest?.systemPrompt).toBe(SARAH_CFO_PERSONA.systemPrompt);
  });

  describe('generateRosterContributions', () => {
    it('dispatches to every persona in parallel and returns each contribution (gate skipped)', async () => {
      const routingService = makeFakeRoutingService(async (request) => ({
        content: `response to: ${request.systemPrompt.slice(0, 20)}`,
        model: 'fake-model',
        usage: { inputTokens: 1, outputTokens: 1 },
      }));
      const completeSpy = vi.spyOn(routingService, 'complete');

      const runtime = new AgentRuntime(routingService);
      const results = await runtime.generateRosterContributions(
        TENANT_CONTEXT,
        [SARAH_CFO_PERSONA, PRIYA_CMO_PERSONA, MARCUS_DEVILS_ADVOCATE_PERSONA],
        { message: 'Should we raise now or wait?' },
        { skipGate: true },
      );

      expect(completeSpy).toHaveBeenCalledTimes(3);
      expect(results).toHaveLength(3);
      expect(results.map((r) => r.persona.name)).toEqual([
        'Sarah Chen',
        'Priya Reddy',
        'Marcus Webb',
      ]);
      expect(results.every((r) => r.contribution !== null && r.error === null)).toBe(true);
    });

    it('tells each persona who their real teammates are, excluding themselves', async () => {
      const capturedPrompts: string[] = [];
      const routingService = makeFakeRoutingService(async (request) => {
        capturedPrompts.push(request.systemPrompt);
        return { content: 'ok', model: 'fake-model', usage: { inputTokens: 1, outputTokens: 1 } };
      });

      const runtime = new AgentRuntime(routingService);
      await runtime.generateRosterContributions(
        TENANT_CONTEXT,
        [SARAH_CFO_PERSONA, PRIYA_CMO_PERSONA, MARCUS_DEVILS_ADVOCATE_PERSONA],
        { message: 'hello' },
        { skipGate: true },
      );

      const sarahPrompt = capturedPrompts[0] as string;
      expect(sarahPrompt).toContain('Priya Reddy, Chief Marketing Officer');
      expect(sarahPrompt).toContain("Marcus Webb, Devil's Advocate");
      expect(sarahPrompt).not.toContain('Sarah Chen, Chief Financial Officer');
      expect(sarahPrompt).not.toContain('Maya');
      expect(sarahPrompt).not.toContain('Raj');
    });

    it("isolates one persona's failure from the others rather than failing the whole roster", async () => {
      let callCount = 0;
      const routingService: RoutingService = {
        complete: vi.fn(async () => {
          callCount += 1;
          if (callCount === 2) {
            throw new Error('provider unavailable');
          }
          return { content: 'ok', model: 'fake-model', usage: { inputTokens: 1, outputTokens: 1 } };
        }),
      } as unknown as RoutingService;

      const runtime = new AgentRuntime(routingService);
      const results = await runtime.generateRosterContributions(
        TENANT_CONTEXT,
        [SARAH_CFO_PERSONA, PRIYA_CMO_PERSONA, MARCUS_DEVILS_ADVOCATE_PERSONA],
        { message: 'hello' },
        { skipGate: true },
      );

      expect(results).toHaveLength(3);
      const failed = results.find((r) => r.error !== null);
      const succeeded = results.filter((r) => r.error === null);
      expect(failed).toBeDefined();
      expect(failed?.contribution).toBeNull();
      expect(succeeded).toHaveLength(2);
      expect(succeeded.every((r) => r.contribution !== null)).toBe(true);
    });

    describe('response gate', () => {
      it('skips a persona whose gate returns shouldRespond=false', async () => {
        let callCount = 0;
        const routingService = makeFakeRoutingService(async () => {
          callCount += 1;
          // Gate calls return low-relevance JSON; contribution calls return content
          if (callCount <= 3) {
            // Gate call: first persona irrelevant, others relevant
            if (callCount === 1) {
              return {
                content:
                  '{"shouldRespond":false,"relevanceScore":0.1,"reason":"not a finance topic"}',
                model: 'fake',
                usage: { inputTokens: 1, outputTokens: 1 },
              };
            }
            return {
              content: '{"shouldRespond":true,"relevanceScore":0.9,"reason":"highly relevant"}',
              model: 'fake',
              usage: { inputTokens: 1, outputTokens: 1 },
            };
          }
          return {
            content: 'contribution text',
            model: 'fake',
            usage: { inputTokens: 1, outputTokens: 1 },
          };
        });

        const runtime = new AgentRuntime(routingService);
        const results = await runtime.generateRosterContributions(
          TENANT_CONTEXT,
          [SARAH_CFO_PERSONA, PRIYA_CMO_PERSONA, MARCUS_DEVILS_ADVOCATE_PERSONA],
          { message: 'What marketing channels should we prioritize?' },
        );

        expect(results).toHaveLength(3);
        expect(results[0]!.skipped).toBe(true);
        expect(results[0]!.contribution).toBeNull();
        expect(results[1]!.skipped).toBe(false);
        expect(results[2]!.skipped).toBe(false);
      });

      it('defaults to shouldRespond=true when gate response is not valid JSON', async () => {
        const routingService = makeFakeRoutingService(async () => ({
          content: 'not json at all',
          model: 'fake',
          usage: { inputTokens: 1, outputTokens: 1 },
        }));

        const runtime = new AgentRuntime(routingService);
        const gate = await runtime.checkShouldRespond(TENANT_CONTEXT, SARAH_CFO_PERSONA, 'hello');

        expect(gate.shouldRespond).toBe(true);
        expect(gate.relevanceScore).toBe(1.0);
      });

      it('exposes gateResult in each roster entry', async () => {
        const routingService = makeFakeRoutingService(async () => ({
          content: '{"shouldRespond":true,"relevanceScore":0.8,"reason":"relevant"}',
          model: 'fake',
          usage: { inputTokens: 1, outputTokens: 1 },
        }));

        const runtime = new AgentRuntime(routingService);
        const results = await runtime.generateRosterContributions(
          TENANT_CONTEXT,
          [SARAH_CFO_PERSONA],
          { message: 'What is our burn rate?' },
        );

        expect(results[0]!.gateResult).toBeDefined();
        expect(results[0]!.gateResult?.shouldRespond).toBe(true);
        expect(results[0]!.gateResult?.relevanceScore).toBe(0.8);
      });
    });
  });
});
