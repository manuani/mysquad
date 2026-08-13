/**
 * Decides when the founder has actually finished speaking.
 *
 * Deepgram's `is_final` means "this transcript segment is stable and will not
 * be revised" — it fires on the brief pauses inside a sentence, not at the end
 * of a turn. Dispatching on it made the advisors answer half a thought: asked
 * "should we cut the marketing budget, or raise a bridge round?", they replied
 * to "should we cut the marketing budget" while the founder was still saying
 * the rest. The old code also assigned rather than appended, so the second half
 * arrived as a separate question with the first half missing.
 *
 * People pause mid-thought. Ending a turn on silence alone interrupts them;
 * waiting too long makes the room feel dead. So this accumulates stable
 * segments and only closes the turn once speech has genuinely stopped for
 * `settleMs` — and any new speech inside that window reopens it, because a
 * pause the founder intended to speak through is not an ending.
 *
 * Signals used, weakest to strongest:
 *   is_final     — segment is stable; the founder may well continue
 *   speech_final — Deepgram's endpointing thinks the utterance ended
 *   UtteranceEnd — silence exceeded `utterance_end_ms` server-side
 *
 * Neither of the latter two is trusted outright: both fire on a long
 * mid-sentence breath. They start the settle window rather than ending the turn.
 */

export interface TurnDetectorOptions {
  /**
   * Silence after apparent end-of-speech before the turn is considered over.
   * Long enough to speak through a thinking pause, short enough that the room
   * does not feel unresponsive. Conversation-analysis work puts a normal
   * between-turn gap near 200 ms, but a founder reasoning aloud pauses for
   * longer, and interrupting them is more costly here than a beat of latency.
   */
  readonly settleMs?: number;
  /**
   * Hard cap on how long one turn may accumulate before dispatching anyway, so
   * a long monologue still gets a response and a missed end-of-speech signal
   * cannot strand the buffer forever.
   */
  readonly maxTurnMs?: number;
  /** Called once per completed turn with the full accumulated text. */
  readonly onTurnComplete: (text: string) => void;
  /** Injectable for tests. */
  readonly now?: () => number;
  readonly setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  readonly clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface TurnDetector {
  /** A transcript segment from Deepgram. */
  onTranscript(text: string, isFinal: boolean, speechFinal?: boolean): void;
  /** Deepgram's UtteranceEnd event — silence passed `utterance_end_ms`. */
  onUtteranceEnd(): void;
  /** Flush any buffered speech immediately (session ending, mic off). */
  flush(): void;
  close(): void;
}

const DEFAULT_SETTLE_MS = 900;
const DEFAULT_MAX_TURN_MS = 30_000;

export function createTurnDetector(options: TurnDetectorOptions): TurnDetector {
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const maxTurnMs = options.maxTurnMs ?? DEFAULT_MAX_TURN_MS;
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h));

  /** Stable segments for the turn in progress, in order. */
  let segments: string[] = [];
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let maxTimer: ReturnType<typeof setTimeout> | undefined;
  let turnStartedAt: number | undefined;
  let closed = false;

  function clearSettle(): void {
    if (settleTimer !== undefined) {
      clearTimer(settleTimer);
      settleTimer = undefined;
    }
  }

  function clearMax(): void {
    if (maxTimer !== undefined) {
      clearTimer(maxTimer);
      maxTimer = undefined;
    }
  }

  function complete(): void {
    clearSettle();
    clearMax();
    turnStartedAt = undefined;

    const text = segments.join(' ').replace(/\s+/g, ' ').trim();
    segments = [];
    if (text) options.onTurnComplete(text);
  }

  /** Arms the settle window. Called on every end-of-speech hint. */
  function armSettle(): void {
    if (closed || segments.length === 0) return;
    clearSettle();
    settleTimer = setTimer(() => {
      settleTimer = undefined;
      complete();
    }, settleMs);
  }

  return {
    onTranscript(text, isFinal, speechFinal = false) {
      if (closed) return;
      const trimmed = (text ?? '').trim();

      // Any speech at all — including an interim result — means the founder is
      // still going, so a settle window opened by an earlier pause is void.
      // Without this, a pause long enough to arm the timer would end the turn
      // even though the founder had already started speaking again.
      if (trimmed) clearSettle();

      if (!isFinal) return;
      if (!trimmed) {
        // A final with no text is Deepgram reporting silence; treat it as a
        // hint that speech has stopped rather than as content.
        if (speechFinal) armSettle();
        return;
      }

      segments.push(trimmed);

      if (turnStartedAt === undefined) {
        turnStartedAt = now();
        clearMax();
        maxTimer = setTimer(() => {
          maxTimer = undefined;
          complete();
        }, maxTurnMs);
      }

      if (speechFinal) armSettle();
    },

    onUtteranceEnd() {
      if (closed) return;
      armSettle();
    },

    flush() {
      if (closed) return;
      complete();
    },

    close() {
      closed = true;
      clearSettle();
      clearMax();
      segments = [];
    },
  };
}
