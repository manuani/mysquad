import { describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '@voai/auth-context';
import type { LlmCompletionRequest, LlmCompletionResult, RoutingService } from '@voai/routing';
import { AgentRuntime } from '../src/agent-runtime.js';
import { SARAH_CFO_PERSONA } from '../src/personas/sarah-cfo.js';
import { PRIYA_CMO_PERSONA } from '../src/personas/priya-cmo.js';
import { MARCUS_DEVILS_ADVOCATE_PERSONA } from '../src/personas/marcus-devils-advocate.js';

const TC: TenantContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  userType: 'founder',
  sessionId: 'session-1',
};

function makeRouting(impl: (r: LlmCompletionRequest) => LlmCompletionResult): RoutingService {
  return {
    complete: vi.fn(async (_tc: TenantContext, req: LlmCompletionRequest) => impl(req)),
  } as unknown as RoutingService;
}

describe('generateOrderedContributions', () => {
  it('returns ordered array with rank field starting at 1', async () => {
    // Gate calls return all-pass JSON, contribution calls return text
    let call = 0;
    const routing = makeRouting((req) => {
      call++;
      // Gate calls (maxTokens 80) return valid JSON
      if (req.maxTokens === 80) {
        return {
          content: '{"shouldRespond":true,"relevanceScore":0.9,"reason":"relevant"}',
          model: 'fake',
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      }
      return {
        content: `contribution-${call}`,
        model: 'fake',
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    });

    const runtime = new AgentRuntime(routing);
    const { ordered } = await runtime.generateOrderedContributions(
      TC,
      [SARAH_CFO_PERSONA, PRIYA_CMO_PERSONA],
      {
        message: 'How should we grow?',
      },
    );

    expect(ordered.length).toBeGreaterThanOrEqual(1);
    expect(ordered.every((r) => r.rank > 0)).toBe(true);
    expect(ordered[0]!.rank).toBe(1);
    if (ordered.length > 1) expect(ordered[1]!.rank).toBe(2);
  });

  it('each contribution has agentName and content', async () => {
    const routing = makeRouting((req) => {
      if (req.maxTokens === 80) {
        return {
          content: '{"shouldRespond":true,"relevanceScore":0.85,"reason":"ok"}',
          model: 'fake',
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      }
      return { content: 'good insight', model: 'fake', usage: { inputTokens: 5, outputTokens: 5 } };
    });

    const runtime = new AgentRuntime(routing);
    const { ordered } = await runtime.generateOrderedContributions(TC, [SARAH_CFO_PERSONA], {
      message: 'what is our burn?',
    });

    expect(ordered[0]!.contribution.agentName).toBe('Sarah Chen');
    expect(ordered[0]!.contribution.content).toBe('good insight');
  });

  it('second persona prompt includes first persona response as context', async () => {
    const capturedPrompts: string[] = [];
    let gateCall = 0;

    const routing = makeRouting((req) => {
      if (req.maxTokens === 80) {
        gateCall++;
        return {
          content: '{"shouldRespond":true,"relevanceScore":0.9,"reason":"ok"}',
          model: 'fake',
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      }
      capturedPrompts.push(req.systemPrompt);
      return {
        content: `response-${capturedPrompts.length}`,
        model: 'fake',
        usage: { inputTokens: 5, outputTokens: 5 },
      };
    });

    const runtime = new AgentRuntime(routing);
    await runtime.generateOrderedContributions(
      TC,
      [SARAH_CFO_PERSONA, PRIYA_CMO_PERSONA],
      { message: 'How do we grow?' },
      { maxSpeakers: 2, skipGate: true },
    );

    // Second persona's system prompt should mention what the first said
    expect(capturedPrompts.length).toBeGreaterThanOrEqual(2);
    expect(capturedPrompts[1]).toContain('already responded');
  });

  it('skipped personas are returned separately', async () => {
    // Gate: Sarah passes, Priya and Marcus fail
    const routing = makeRouting((req) => {
      if (req.maxTokens === 80) {
        const body = req.messages[0]?.content ?? '';
        if (body.includes('Chief Financial')) {
          return {
            content: '{"shouldRespond":true,"relevanceScore":0.9,"reason":"finance topic"}',
            model: 'fake',
            usage: { inputTokens: 1, outputTokens: 1 },
          };
        }
        return {
          content: '{"shouldRespond":false,"relevanceScore":0.2,"reason":"not relevant"}',
          model: 'fake',
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      }
      return { content: 'sarah reply', model: 'fake', usage: { inputTokens: 5, outputTokens: 5 } };
    });

    const runtime = new AgentRuntime(routing);
    const { ordered, skipped } = await runtime.generateOrderedContributions(
      TC,
      [SARAH_CFO_PERSONA, PRIYA_CMO_PERSONA, MARCUS_DEVILS_ADVOCATE_PERSONA],
      { message: 'Analyse our burn rate' },
    );

    expect(ordered.length + skipped.length).toBe(3);
  });

  it('respects maxSpeakers cap even when all personas pass the gate', async () => {
    const routing = makeRouting((req) => {
      if (req.maxTokens === 80) {
        return {
          content: '{"shouldRespond":true,"relevanceScore":0.95,"reason":"all pass"}',
          model: 'fake',
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      }
      return { content: 'contribution', model: 'fake', usage: { inputTokens: 5, outputTokens: 5 } };
    });

    const runtime = new AgentRuntime(routing);
    const { ordered } = await runtime.generateOrderedContributions(
      TC,
      [SARAH_CFO_PERSONA, PRIYA_CMO_PERSONA, MARCUS_DEVILS_ADVOCATE_PERSONA],
      { message: 'What is our strategy?' },
      { maxSpeakers: 1 },
    );

    expect(ordered).toHaveLength(1);
  });

  it('compositeScore is between 0 and 1 inclusive', async () => {
    const routing = makeRouting((req) => {
      if (req.maxTokens === 80) {
        return {
          content: '{"shouldRespond":true,"relevanceScore":0.7,"reason":"ok"}',
          model: 'fake',
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      }
      return { content: 'ok', model: 'fake', usage: { inputTokens: 5, outputTokens: 5 } };
    });

    const runtime = new AgentRuntime(routing);
    const { ordered } = await runtime.generateOrderedContributions(TC, [SARAH_CFO_PERSONA], {
      message: 'question',
    });

    for (const r of ordered) {
      expect(r.compositeScore).toBeGreaterThanOrEqual(0);
      expect(r.compositeScore).toBeLessThanOrEqual(1);
    }
  });
});
