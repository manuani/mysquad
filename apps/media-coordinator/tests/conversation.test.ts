/**
 * `priorTurns` was threaded through agent-runtime from the beginning but never
 * populated, so every turn reached the advisors with only the latest utterance.
 * They could not refer back to anything said earlier in the meeting they were
 * in. Separately, the transcript lived in process memory and was discarded when
 * the meeting ended.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversation } from '../src/conversation.js';

const API = 'http://api.test';
const SESSION = '11111111-1111-1111-1111-111111111111';
const AUTH = { 'x-tenant-id': 't1', 'x-user-id': 'u1' };

function setup(opts: { meetingSessionId?: string; maxTurns?: number } = {}) {
  const onError = vi.fn();
  const conversation = createConversation({
    ...(opts.meetingSessionId === undefined ? {} : { meetingSessionId: opts.meetingSessionId }),
    ...(opts.maxTurns === undefined ? {} : { maxTurns: opts.maxTurns }),
    apiServerUrl: API,
    authHeaders: AUTH,
    onError,
  });
  return { conversation, onError };
}

// These exercise the in-memory history only, so they run without a meeting
// session. Passing one would enqueue transcript writes that outlive the test
// and land on the next test's fetch mock.
describe('conversation history', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 201 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps both sides of the exchange in order', () => {
    const { conversation } = setup();
    conversation.recordFounder('We are not converting.');
    conversation.recordAdvisor('Sarah Chen', 'Three customers is a small sample.');

    expect(conversation.history()).toEqual([
      { role: 'user', content: 'We are not converting.' },
      { role: 'assistant', content: 'Sarah Chen: Three customers is a small sample.' },
    ]);
  });

  it('attributes each advisor by name', () => {
    // The model sees a flat assistant turn, so three advisors are otherwise
    // indistinguishable from one another in the history.
    const { conversation } = setup();
    conversation.recordAdvisor('Priya Reddy', 'Positioning is the issue.');
    expect(conversation.history()[0]!.content).toBe('Priya Reddy: Positioning is the issue.');
  });

  it('ignores empty or whitespace-only turns', () => {
    const { conversation } = setup();
    conversation.recordFounder('   ');
    conversation.recordAdvisor('Sarah Chen', '');
    expect(conversation.history()).toEqual([]);
  });

  it('bounds what travels with each request', () => {
    // Prior turns are inlined into every persona's prompt, so an unbounded
    // history would inflate the cost of every later turn in a long meeting.
    const { conversation } = setup({ maxTurns: 4 });
    for (let i = 0; i < 10; i++) conversation.recordFounder(`turn ${i}`);

    const history = conversation.history();
    expect(history).toHaveLength(4);
    expect(history[0]!.content).toBe('turn 6');
    expect(history[3]!.content).toBe('turn 9');
  });

  it('works without a meeting session, in memory only', () => {
    const { conversation } = setup();
    conversation.recordFounder('still following along');
    expect(conversation.history()).toHaveLength(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('persistence', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('writes each turn to the meeting transcript', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return new Response('{}', { status: 201 });
    }));

    const { conversation } = setup({ meetingSessionId: SESSION });
    conversation.recordFounder('We are not converting.', 'Mura');
    conversation.recordAdvisor('Sarah Chen', 'Three customers is a small sample.');
    await vi.waitFor(() => expect(calls).toHaveLength(2));

    expect(calls[0]!.url).toBe(`${API}/v1/meeting/sessions/${SESSION}/transcript`);
    expect(calls[0]!.body).toMatchObject({ speakerType: 'founder', speakerName: 'Mura' });
    expect(calls[1]!.body).toMatchObject({ speakerType: 'agent', speakerName: 'Sarah Chen' });
  });

  it('writes one at a time, in order', async () => {
    // appendTranscriptEntry assigns sequence_number by reading the current
    // maximum inside its transaction, and (session_id, sequence_number) is
    // unique. Concurrent writes read the same maximum, so one insert lost the
    // race and that advisor's reply was dropped from the record.
    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];

    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(JSON.parse(String(init.body)).speakerName);
      await new Promise((r) => setTimeout(r, 10));
      inFlight -= 1;
      return new Response('{}', { status: 201 });
    }));

    const { conversation } = setup({ meetingSessionId: SESSION });
    conversation.recordFounder('question', 'Mura');
    conversation.recordAdvisor('Sarah Chen', 'first');
    conversation.recordAdvisor('Marcus Webb', 'second');

    await vi.waitFor(() => expect(order).toHaveLength(3));
    expect(maxInFlight).toBe(1);
    expect(order).toEqual(['Mura', 'Sarah Chen', 'Marcus Webb']);
  });

  it('keeps storing later turns after one write fails', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      n += 1;
      // A rejected chain must not stop every subsequent turn being stored.
      if (n === 1) throw new Error('transient');
      return new Response('{}', { status: 201 });
    }));

    const { conversation, onError } = setup({ meetingSessionId: SESSION });
    conversation.recordFounder('first');
    conversation.recordFounder('second');

    await vi.waitFor(() => expect(n).toBe(2));
    expect(onError).toHaveBeenCalled();
  });

  it('does not make the caller wait on the write', () => {
    // A slow or failing store must never delay an advisor's reply.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))); // never settles
    const { conversation } = setup({ meetingSessionId: SESSION });

    conversation.recordFounder('hello');

    // History is updated synchronously despite the write hanging.
    expect(conversation.history()).toHaveLength(1);
  });

  it('reports a failed write without losing the turn', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const { conversation, onError } = setup({ meetingSessionId: SESSION });

    conversation.recordFounder('hello');
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());

    // A meeting that cannot be saved is worse than one that is not saved.
    expect(conversation.history()).toHaveLength(1);
  });
});

describe('restore', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rebuilds the conversation from a previous meeting', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(
        JSON.stringify({
          entries: [
            { speakerType: 'founder', speakerName: 'Mura', content: 'Where did we get to?' },
            { speakerType: 'agent', speakerName: 'Sarah Chen', content: 'Six months of runway.' },
          ],
        }),
        { status: 200 },
      ),
    ));

    const { conversation } = setup({ meetingSessionId: SESSION });
    await conversation.restore();

    expect(conversation.history()).toEqual([
      { role: 'user', content: 'Where did we get to?' },
      { role: 'assistant', content: 'Sarah Chen: Six months of runway.' },
    ]);
  });

  it('starts fresh when there is nothing stored', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ entries: [] }), { status: 200 })));
    const { conversation } = setup({ meetingSessionId: SESSION });
    await conversation.restore();
    expect(conversation.history()).toEqual([]);
  });

  it('starts fresh rather than failing when the transcript cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const { conversation, onError } = setup({ meetingSessionId: SESSION });

    await expect(conversation.restore()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalled();
    expect(conversation.history()).toEqual([]);
  });

  it('only restores as much as travels with a request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(
        JSON.stringify({
          entries: Array.from({ length: 30 }, (_, i) => ({
            speakerType: 'founder', speakerName: 'Mura', content: `turn ${i}`,
          })),
        }),
        { status: 200 },
      ),
    ));

    const { conversation } = setup({ meetingSessionId: SESSION, maxTurns: 5 });
    await conversation.restore();

    const history = conversation.history();
    expect(history).toHaveLength(5);
    expect(history[4]!.content).toBe('turn 29');
  });
});
