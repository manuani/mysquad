import { describe, expect, it, vi, beforeEach } from 'vitest';
import { isPlatformError } from '@voai/errors';

const createMock = vi.fn();
const constructorArgs: unknown[] = [];

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class Anthropic {
      messages = { create: createMock };
      constructor(opts: unknown) {
        constructorArgs.push(opts);
      }
    },
  };
});

// Import after mocking so the module under test picks up the mocked SDK.
const { AnthropicProvider } = await import('../src/anthropic-provider.js');

describe('AnthropicProvider', () => {
  beforeEach(() => {
    createMock.mockReset();
    constructorArgs.length = 0;
  });

  it('fails clearly when no API key is configured, without making a network call', async () => {
    const provider = new AnthropicProvider(undefined);

    await expect(
      provider.complete({ systemPrompt: 'sys', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toSatisfy((err: unknown) => {
      if (!isPlatformError(err)) return false;
      return err.code === 'PROVIDER_UNAVAILABLE' && err.httpStatus === 503;
    });

    expect(createMock).not.toHaveBeenCalled();
  });

  it('maps the Anthropic SDK response shape to LlmCompletionResult', async () => {
    createMock.mockResolvedValue({
      model: 'claude-sonnet-4-5',
      content: [{ type: 'text', text: 'hello there' }],
      usage: { input_tokens: 12, output_tokens: 4 },
    });

    const provider = new AnthropicProvider('test-key');
    const result = await provider.complete({
      systemPrompt: 'You are helpful.',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 256,
    });

    expect(result).toEqual({
      content: 'hello there',
      model: 'claude-sonnet-4-5',
      tier: 'high',
      usage: { inputTokens: 12, outputTokens: 4 },
      totalCostMicro: expect.any(Number),
    });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-5',
        max_tokens: 256,
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );
  });

  it('joins multiple text content blocks and ignores non-text blocks', async () => {
    createMock.mockResolvedValue({
      model: 'claude-sonnet-4-5',
      content: [
        { type: 'text', text: 'part one ' },
        { type: 'tool_use', id: 'x', name: 'noop', input: {} },
        { type: 'text', text: 'part two' },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const provider = new AnthropicProvider('test-key');
    const result = await provider.complete({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.content).toBe('part one part two');
  });

  it('forwards requestId as x-request-id default header', async () => {
    createMock.mockResolvedValue({
      model: 'claude-sonnet-4-5',
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const provider = new AnthropicProvider('test-key');
    await provider.complete({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      requestId: 'trace-abc-123',
    });

    const opts = constructorArgs[constructorArgs.length - 1] as Record<string, unknown>;
    expect((opts['defaultHeaders'] as Record<string, string>)['x-request-id']).toBe('trace-abc-123');
  });
});
