import { describe, expect, it, vi } from 'vitest';
import { createPipelineSession } from '../src/pipeline.js';
import type { SttClient, SttSession } from '../src/stt.js';
import type { TtsClient } from '../src/tts.js';
import { EventEmitter } from 'node:events';

function makeStt(onConnect: (emit: (text: string, isFinal: boolean) => void) => void): SttClient {
  return {
    startSession(onTranscript) {
      const emitter = new EventEmitter() as SttSession;
      emitter.sendAudio = vi.fn();
      emitter.close = vi.fn();
      onConnect(onTranscript);
      return emitter;
    },
  };
}

function makeTts(audioMap: Record<string, Buffer> = {}): TtsClient {
  return {
    async synthesise(text: string, voiceId: string): Promise<Buffer | null> {
      return audioMap[voiceId] ?? Buffer.from('audio-stub');
    },
  };
}

function makeOpts(overrides: Partial<Parameters<typeof createPipelineSession>[2]> = {}) {
  return {
    sessionId: 'sess-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    apiServerUrl: 'http://localhost:3000',
    authHeaders: {
      'x-tenant-id': 'tenant-1',
      'x-user-id': 'user-1',
      'x-user-type': 'founder',
      'x-session-id': 'tok',
    },
    onContributions: vi.fn(),
    onTranscriptChunk: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

describe('createPipelineSession', () => {
  it('returns a session with sendAudio and close', () => {
    let emitFn: ((text: string, isFinal: boolean) => void) | undefined;
    const stt = makeStt((e) => {
      emitFn = e;
    });
    const sess = createPipelineSession(stt, makeTts(), makeOpts());
    expect(typeof sess.sendAudio).toBe('function');
    expect(typeof sess.close).toBe('function');
  });

  it('calls onTranscriptChunk for each STT event', () => {
    const onTranscriptChunk = vi.fn();
    let emitFn!: (text: string, isFinal: boolean) => void;
    const stt = makeStt((e) => {
      emitFn = e;
    });
    createPipelineSession(stt, makeTts(), makeOpts({ onTranscriptChunk }));

    emitFn('hello', false);
    expect(onTranscriptChunk).toHaveBeenCalledWith('hello', false);

    emitFn('hello world', true);
    expect(onTranscriptChunk).toHaveBeenCalledWith('hello world', true);
  });

  it('calls onError when agent-runtime fetch fails', async () => {
    const onError = vi.fn();
    let emitFn!: (text: string, isFinal: boolean) => void;
    const stt = makeStt((e) => {
      emitFn = e;
    });

    // Mock fetch to reject
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    createPipelineSession(stt, makeTts(), makeOpts({ onError }));
    emitFn('what is our burn rate', true);

    // Wait for async processing
    await new Promise((r) => setTimeout(r, 50));
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('connection refused') }),
    );

    vi.unstubAllGlobals();
  });

  it('calls onContributions after successful fetch', async () => {
    const onContributions = vi.fn();
    let emitFn!: (text: string, isFinal: boolean) => void;
    const stt = makeStt((e) => {
      emitFn = e;
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          contributions: [
            {
              agentName: 'Sarah Chen',
              role: 'CFO',
              contribution: { content: 'Your burn is 3 months.' },
              rank: 1,
              skipped: false,
            },
          ],
        }),
      }),
    );

    createPipelineSession(stt, makeTts(), makeOpts({ onContributions }));
    emitFn('what is our runway', true);

    await new Promise((r) => setTimeout(r, 50));
    expect(onContributions).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ agentName: 'Sarah Chen', text: 'Your burn is 3 months.' }),
      ]),
    );

    vi.unstubAllGlobals();
  });

  it('skips skipped contributions when building TTS', async () => {
    const onContributions = vi.fn();
    const tts = { synthesise: vi.fn().mockResolvedValue(Buffer.from('audio')) };
    let emitFn!: (text: string, isFinal: boolean) => void;
    const stt = makeStt((e) => {
      emitFn = e;
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          contributions: [
            {
              agentName: 'Sarah Chen',
              role: 'CFO',
              contribution: { content: 'reply' },
              rank: 1,
              skipped: false,
            },
            { agentName: 'Priya Reddy', role: 'CMO', contribution: null, rank: 0, skipped: true },
          ],
        }),
      }),
    );

    createPipelineSession(stt, tts, makeOpts({ onContributions }));
    emitFn('question', true);

    await new Promise((r) => setTimeout(r, 50));
    // TTS should only be called for the non-skipped persona
    const [batch] = onContributions.mock.calls[0] as [(typeof onContributions.mock.calls)[0][0]];
    expect(batch).toHaveLength(1);
    expect(batch[0].agentName).toBe('Sarah Chen');

    vi.unstubAllGlobals();
  });

  it('onError called when agent-runtime returns non-ok status', async () => {
    const onError = vi.fn();
    let emitFn!: (text: string, isFinal: boolean) => void;
    const stt = makeStt((e) => {
      emitFn = e;
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    createPipelineSession(stt, makeTts(), makeOpts({ onError }));
    emitFn('question', true);

    await new Promise((r) => setTimeout(r, 50));
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('500') }),
    );

    vi.unstubAllGlobals();
  });
});
