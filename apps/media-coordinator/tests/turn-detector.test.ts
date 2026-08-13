/**
 * Turn-taking regression tests.
 *
 * Observed in the meeting UI: asked "should we cut the marketing budget, or
 * raise a bridge round?", the advisors answered "should we cut the marketing
 * budget" while the founder was still speaking. Deepgram's `is_final` fires on
 * the pauses inside a sentence, and the pipeline dispatched on it — and
 * assigned rather than appended, so the second half arrived as its own question
 * with the first half gone.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTurnDetector } from '../src/turn-detector.js';

function harness(settleMs = 900) {
  const turns: string[] = [];
  const detector = createTurnDetector({ settleMs, onTurnComplete: (t) => turns.push(t) });
  return { turns, detector };
}

describe('turn detection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  it('waits through a mid-sentence pause instead of answering half a thought', async () => {
    const { turns, detector } = harness();

    // The exact shape Deepgram produced: a stable segment, a pause, then more.
    detector.onTranscript('Should we cut the marketing budget', true, false);
    await vi.advanceTimersByTimeAsync(400);
    expect(turns).toHaveLength(0); // previously dispatched here

    detector.onTranscript('or raise a bridge round?', true, true);
    await vi.advanceTimersByTimeAsync(900);

    expect(turns).toEqual(['Should we cut the marketing budget or raise a bridge round?']);
  });

  it('keeps both halves — the old code replaced rather than appended', async () => {
    const { turns, detector } = harness();
    detector.onTranscript('We are burning forty thousand a month', true, false);
    detector.onTranscript('and have six months of runway', true, true);
    await vi.advanceTimersByTimeAsync(900);

    expect(turns[0]).toContain('burning forty thousand');
    expect(turns[0]).toContain('six months of runway');
  });

  it('reopens the turn when the founder speaks through the settle window', async () => {
    const { turns, detector } = harness();

    detector.onTranscript('I was thinking', true, true);
    await vi.advanceTimersByTimeAsync(500); // settle armed but not elapsed

    // They carry on — even an interim result proves they are still going.
    detector.onTranscript('actually', false, false);
    await vi.advanceTimersByTimeAsync(800);
    expect(turns).toHaveLength(0);

    detector.onTranscript('actually we should wait', true, true);
    await vi.advanceTimersByTimeAsync(900);

    expect(turns).toEqual(['I was thinking actually we should wait']);
  });

  it('dispatches once speech has genuinely stopped', async () => {
    const { turns, detector } = harness();
    detector.onTranscript('What is our runway?', true, true);

    await vi.advanceTimersByTimeAsync(899);
    expect(turns).toHaveLength(0); // still within the settle window

    await vi.advanceTimersByTimeAsync(1);
    expect(turns).toEqual(['What is our runway?']);
  });

  it('treats UtteranceEnd as a hint, not an ending', async () => {
    const { turns, detector } = harness();
    detector.onTranscript('Hold on', true, false);
    detector.onUtteranceEnd();

    // Founder resumes before the window closes.
    await vi.advanceTimersByTimeAsync(300);
    detector.onTranscript('let me finish the thought', true, true);
    await vi.advanceTimersByTimeAsync(900);

    expect(turns).toEqual(['Hold on let me finish the thought']);
  });

  it('emits one turn per stretch of speech, not one per segment', async () => {
    const { turns, detector } = harness();

    detector.onTranscript('First question.', true, true);
    await vi.advanceTimersByTimeAsync(900);
    detector.onTranscript('Second question.', true, true);
    await vi.advanceTimersByTimeAsync(900);

    expect(turns).toEqual(['First question.', 'Second question.']);
  });

  it('ignores interim results as turn boundaries', async () => {
    const { turns, detector } = harness();
    detector.onTranscript('Should we', false, false);
    detector.onTranscript('Should we cut', false, false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(turns).toHaveLength(0);
  });

  it('caps a monologue so a missed end-of-speech cannot strand the buffer', async () => {
    const turns: string[] = [];
    const detector = createTurnDetector({
      settleMs: 900,
      maxTurnMs: 2_000,
      onTurnComplete: (t) => turns.push(t),
    });

    // Continuous speech, never signalling an end.
    for (let i = 0; i < 10; i++) {
      detector.onTranscript(`segment ${i}`, true, false);
      await vi.advanceTimersByTimeAsync(250);
    }

    expect(turns).toHaveLength(1);
    expect(turns[0]).toContain('segment 0');
  });

  it('flushes buffered speech on close rather than dropping the last sentence', () => {
    const { turns, detector } = harness();
    detector.onTranscript('One last thing', true, false);
    detector.flush();
    expect(turns).toEqual(['One last thing']);
  });

  it('emits nothing when no speech was buffered', () => {
    const { turns, detector } = harness();
    detector.flush();
    expect(turns).toEqual([]);
  });

  it('collapses whitespace across joined segments', async () => {
    const { turns, detector } = harness();
    detector.onTranscript('  spaced   out  ', true, false);
    detector.onTranscript('  segments ', true, true);
    await vi.advanceTimersByTimeAsync(900);
    expect(turns).toEqual(['spaced out segments']);
  });

  it('goes quiet after close', async () => {
    const { turns, detector } = harness();
    detector.onTranscript('anything', true, true);
    detector.close();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(turns).toEqual([]);
  });
});
