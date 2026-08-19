/**
 * The conversation so far, held for the meeting and written to the meeting
 * service so it survives it.
 *
 * Two gaps this closes, found by reading the code rather than from a symptom:
 *
 *  1. `priorTurns` was threaded through agent-runtime from the beginning but
 *     never populated. Every turn reached the advisors with only the latest
 *     utterance and the brief, so they could not refer back to anything said
 *     earlier in the meeting they were in. To the founder that reads as an
 *     advisor who was not listening.
 *
 *  2. The transcript lived in media-coordinator process memory and was
 *     discarded when the meeting ended. `transcript_entries` existed and worked,
 *     but nothing in the voice path wrote to it.
 *
 * Kept separate from the pipeline because persistence must never be able to
 * break a live conversation: every write is fire-and-forget, and a failure to
 * store is logged rather than surfaced. A meeting that cannot be saved is worse
 * than one that is not saved.
 */

export interface ConversationTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface ConversationOptions {
  /** Meeting session UUID. Without one, history is in-memory only for this meeting. */
  readonly meetingSessionId?: string;
  readonly apiServerUrl: string;
  readonly authHeaders: Record<string, string>;
  readonly onError: (err: Error) => void;
  /**
   * How many turns travel with each request. Prior turns are inlined into every
   * persona's prompt, so this is a per-turn cost that grows with the meeting.
   */
  readonly maxTurns?: number;
}

export interface Conversation {
  /** Turns to send with the next request, oldest first. */
  history(): readonly ConversationTurn[];
  /** Records something the founder said, and persists it. */
  recordFounder(text: string, speakerName?: string): void;
  /** Records an advisor's reply, and persists it. */
  recordAdvisor(agentName: string, text: string): void;
  /** Loads what was said before this meeting resumed. */
  restore(): Promise<void>;
}

const DEFAULT_MAX_TURNS = 12;

export function createConversation(opts: ConversationOptions): Conversation {
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  let turns: ConversationTurn[] = [];

  /**
   * Transcript writes run one at a time.
   *
   * `appendTranscriptEntry` assigns `sequence_number` by reading the current
   * maximum inside its transaction, and `transcript_entries` has a UNIQUE
   * (session_id, sequence_number). Two advisors replying in the same turn
   * produced two concurrent writes that read the same maximum, so one insert
   * lost the race and that advisor's reply was dropped from the record — the
   * meeting looked saved while half of it was missing.
   *
   * Chaining also preserves order, which a transcript needs anyway.
   */
  let writeQueue: Promise<void> = Promise.resolve();

  /**
   * Writes one entry to the meeting service. Never awaited by the caller: a
   * slow or failing write must not delay an advisor's reply.
   */
  function persist(speakerType: 'founder' | 'agent', speakerName: string, content: string): void {
    if (!opts.meetingSessionId) return;

    writeQueue = writeQueue
      .then(async () => {
        const res = await fetch(
          `${opts.apiServerUrl}/v1/meeting/sessions/${opts.meetingSessionId}/transcript`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...opts.authHeaders },
            body: JSON.stringify({ speakerType, speakerName, content }),
          },
        );
        if (!res.ok) {
          opts.onError(new Error(`transcript write failed: ${res.status}`));
        }
      })
      // The chain must survive a failed write, or one error would stop every
      // later turn being stored.
      .catch((err: unknown) => {
        opts.onError(err instanceof Error ? err : new Error(String(err)));
      });
  }

  function push(turn: ConversationTurn): void {
    turns.push(turn);
    // Trim the working window, not the stored record. The database keeps
    // everything; only what travels with each request is bounded.
    if (turns.length > maxTurns) turns = turns.slice(-maxTurns);
  }

  return {
    history() {
      return turns;
    },

    recordFounder(text, speakerName = 'Founder') {
      const content = text.trim();
      if (!content) return;
      push({ role: 'user', content });
      persist('founder', speakerName, content);
    },

    recordAdvisor(agentName, text) {
      const content = text.trim();
      if (!content) return;
      // Attributed in the text as well as the row, because the model sees a
      // flat assistant turn and three advisors are otherwise indistinguishable
      // from one another in the history.
      push({ role: 'assistant', content: `${agentName}: ${content}` });
      persist('agent', agentName, content);
    },

    async restore() {
      if (!opts.meetingSessionId) return;

      try {
        const res = await fetch(
          `${opts.apiServerUrl}/v1/meeting/sessions/${opts.meetingSessionId}/transcript`,
          { headers: opts.authHeaders },
        );
        if (!res.ok) return;

        const body = (await res.json()) as {
          entries?: Array<{ speakerType?: string; speakerName?: string; content?: string }>;
        };
        const entries = Array.isArray(body.entries) ? body.entries : [];

        turns = entries
          .filter((e): e is { speakerType: string; speakerName: string; content: string } =>
            typeof e.content === 'string' && e.content.trim().length > 0,
          )
          .map((e) =>
            e.speakerType === 'agent'
              ? { role: 'assistant' as const, content: `${e.speakerName}: ${e.content}` }
              : { role: 'user' as const, content: e.content },
          )
          .slice(-maxTurns);
      } catch (err) {
        // Starting fresh is a worse meeting, not a broken one.
        opts.onError(err instanceof Error ? err : new Error(String(err)));
      }
    },
  };
}
