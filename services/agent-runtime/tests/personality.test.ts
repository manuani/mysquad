/**
 * Marcus was originally a Devil's Advocate, and the role name alone drove the
 * behaviour: every reply opened with an objection. Rewriting him as Chief of
 * Staff fixed that conversation but swapped one constant for another — a
 * founder in a fundraise wants harder scrutiny than one exploring an idea.
 */

import { describe, expect, it, vi } from 'vitest';
import { personalityGuidance } from '../src/personality.js';
import { AgentRuntime } from '../src/agent-runtime.js';
import { SARAH_CFO_PERSONA } from '../src/personas/sarah-cfo.js';
import type { TenantContext } from '@voai/auth-context';
import type { LlmCompletionRequest, LlmCompletionResult, RoutingService } from '@voai/routing';

const TC: TenantContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  userType: 'founder',
  sessionId: 'session-1',
};

describe('personalityGuidance', () => {
  it('produces nothing when a profile was never configured', () => {
    // An unconfigured profile must behave exactly as before.
    expect(personalityGuidance(null)).toBe('');
    expect(personalityGuidance({})).toBe('');
  });

  it('says nothing for the settings that match the standing charter', () => {
    // Repeating what the charter already says makes it no more likely to be
    // followed, and crowds out the settings that do differ.
    expect(
      personalityGuidance({ challengeLevel: 'balanced', replyLength: 'standard', formality: 'neutral' }),
    ).toBe('');
  });

  it('asks for support rather than scrutiny on light', () => {
    const guidance = personalityGuidance({ challengeLevel: 'light' });
    expect(guidance).toContain('support more than scrutiny');
    expect(guidance).not.toContain('wants to be pushed');
  });

  it('asks for the weak points on hard', () => {
    const guidance = personalityGuidance({ challengeLevel: 'hard' });
    expect(guidance).toContain('wants to be pushed');
    // Still a colleague: being challenged is useful, being interrogated is not.
    expect(guidance).toContain('own position first');
  });

  it("carries free-text instructions as the founder's words", () => {
    const guidance = personalityGuidance({ teamInstructions: 'Always convert to rupees.' });
    expect(guidance).toContain('Always convert to rupees.');
    // Quoted, so it reads as a preference rather than a fact about the business.
    expect(guidance).toContain('"Always convert to rupees."');
  });

  it('bounds free text so one profile cannot dominate every prompt', () => {
    const guidance = personalityGuidance({ teamInstructions: 'x'.repeat(2000) });
    expect(guidance.length).toBeLessThan(1200);
  });

  it('combines settings without dropping any', () => {
    const guidance = personalityGuidance({
      challengeLevel: 'hard',
      replyLength: 'brief',
      formality: 'formal',
    });
    expect(guidance).toContain('wants to be pushed');
    expect(guidance).toContain('two or three sentences');
    expect(guidance).toContain('register professional');
  });
});

describe('personality in the assembled prompt', () => {
  function capture() {
    let prompt = '';
    const routingService = {
      complete: vi.fn(async (_tc: TenantContext, request: LlmCompletionRequest) => {
        prompt = request.systemPrompt;
        return {
          content: 'ok',
          model: 'fake',
          usage: { inputTokens: 1, outputTokens: 1 },
        } as LlmCompletionResult;
      }),
    } as unknown as RoutingService;
    return { routingService, read: () => prompt };
  }

  it('reaches the advisor, after the charter', async () => {
    const { routingService, read } = capture();
    await new AgentRuntime(routingService).generateContribution(TC, SARAH_CFO_PERSONA, {
      message: 'We are doubling ad spend.',
      personality: { challengeLevel: 'hard' },
    });

    const prompt = read();
    expect(prompt).toContain('wants to be pushed');
    // After the charter, so it reads as an adjustment to how the team works
    // rather than as a competing instruction.
    expect(prompt.indexOf('You work for this founder')).toBeLessThan(
      prompt.indexOf('wants to be pushed'),
    );
  });

  it('leaves the prompt alone when nothing is configured', async () => {
    const { routingService, read } = capture();
    await new AgentRuntime(routingService).generateContribution(TC, SARAH_CFO_PERSONA, {
      message: 'We are doubling ad spend.',
    });

    expect(read()).not.toContain('How this founder wants the team to work');
  });
});
