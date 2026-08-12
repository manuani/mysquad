/**
 * Who was actually spoken to, and whether this was a work request at all.
 *
 * Found by exercising the meeting UI: the founder said "Hello, Sarah" and Sarah
 * did not answer. Marcus and Priya did, and each opened by explaining that
 * Sarah Chen is the CFO — sounding like a switchboard rather than colleagues.
 *
 * Two causes, both here:
 *
 *  1. Nothing detected direct address. Ranking scored relevance and silence
 *     only, so with nobody having spoken yet the silence scores tied, a
 *     greeting scored low relevance for everyone, and selection fell through to
 *     the alphabetical tie-break — `marcus-da` before `priya-cmo` before
 *     `sarah-cfo`. The one person named was ordered last and cut by the
 *     two-speaker cap.
 *
 *  2. Nothing distinguished a greeting from a work request, so "hello" was
 *     triaged for domain fit like any other question. The persona prompts tell
 *     each agent to "defer to the right perspective" when a topic is outside
 *     their lane, and against a greeting that instruction produces exactly the
 *     org-chart recital we saw.
 */

/** A persona, reduced to what address detection needs. */
export interface AddressablePersona {
  readonly id: string;
  readonly name: string;
}

export interface AddressAnalysis {
  /** Persona ids the founder named. Empty when the room was addressed generally. */
  readonly addressed: readonly string[];
  /**
   * True when this turn is social rather than a request for work — a greeting,
   * thanks, or small talk. These want one short human reply, not a panel.
   */
  readonly isSocial: boolean;
  /** True when the founder addressed everyone ("hi all", "how are you guys"). */
  readonly addressesRoom: boolean;
}

/**
 * Greetings, sign-offs, and pleasantries. Anchored to the start, or standing
 * alone, so "hello" opening a turn counts but "say hello to the team for me"
 * inside a real request does not.
 */
const SOCIAL_OPENERS =
  /^\s*(hi|hey|hello|good (morning|afternoon|evening)|greetings|yo)\b|^\s*(thanks|thank you|cheers|appreciate it|got it|ok(ay)?|sounds good|nice one|perfect)\b/i;

const SOCIAL_QUESTIONS =
  /\b(how are you|how's it going|how are things|how have you been|you (all|guys) (doing|been)|what's up|hope you'?re well)\b/i;

/** Plural address to the whole room. */
const ROOM_ADDRESS =
  /\b(everyone|everybody|all of you|you all|y'?all|you guys|team|folks|guys)\b/i;

/**
 * A turn is a work request if it asks for something beyond acknowledgement.
 * Checked so "hi Sarah, what's our runway?" is treated as work with a greeting
 * attached, not as small talk.
 */
const SUBSTANTIVE =
  /\b(should|could|would|what|why|how|when|which|who|can we|do we|are we|is it|help|think|advice|recommend|plan|decide|review|look at|walk me|explain)\b/i;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Detects which personas were named and what register the turn is in.
 *
 * Matching covers the full name and the first name, because founders address
 * colleagues the way they would in a room — "Sarah", not "Sarah Chen".
 */
export function analyseAddress(
  message: string,
  personas: readonly AddressablePersona[],
): AddressAnalysis {
  const text = message ?? '';

  const addressed = personas
    .filter((persona) => {
      const first = persona.name.split(/\s+/)[0] ?? persona.name;
      // Word-bounded so "Mark" does not match "marketing" and "Priya" does not
      // match a longer name that contains it.
      const pattern = new RegExp(
        `\\b(${escapeRegExp(persona.name)}|${escapeRegExp(first)})\\b`,
        'i',
      );
      return pattern.test(text);
    })
    .map((persona) => persona.id);

  const hasSocialMarker = SOCIAL_OPENERS.test(text) || SOCIAL_QUESTIONS.test(text);
  const isSubstantive = SUBSTANTIVE.test(text.replace(SOCIAL_QUESTIONS, ''));

  return {
    addressed,
    // "Hi Sarah, what's our runway?" is work with a greeting attached.
    isSocial: hasSocialMarker && !isSubstantive,
    addressesRoom: ROOM_ADDRESS.test(text),
  };
}
