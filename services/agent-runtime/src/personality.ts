/**
 * How a founder wants their team to behave, turned into prompt guidance.
 *
 * Marcus was originally a Devil's Advocate, and the role name alone drove the
 * behaviour: every reply opened with an objection. Rewriting him as Chief of
 * Staff fixed that conversation but swapped one constant for another. A founder
 * in a fundraise wants harder scrutiny than one exploring an idea, and
 * different founders want different amounts of it from the same person.
 *
 * Named settings rather than free text alone, because named settings can be
 * tested: each one has an observable effect that a test can assert on, where a
 * free-text instruction can say anything and hold together for none of three
 * agents. Free text is still accepted, appended last, for the things presets
 * cannot express.
 *
 * Everything here is optional. A profile that has never been configured
 * produces no guidance at all and behaves exactly as it did before.
 */

export type ChallengeLevel = 'light' | 'balanced' | 'hard';
export type ReplyLength = 'brief' | 'standard' | 'thorough';
export type Formality = 'casual' | 'neutral' | 'formal';

export interface TeamPersonality {
  readonly challengeLevel?: ChallengeLevel | null;
  readonly replyLength?: ReplyLength | null;
  readonly formality?: Formality | null;
  readonly teamInstructions?: string | null;
}

/**
 * How hard to push. `balanced` is what the team charter already describes, so
 * it produces no extra guidance — saying the same thing twice in one prompt
 * makes it no more likely to be followed.
 */
const CHALLENGE_GUIDANCE: Record<ChallengeLevel, string> = {
  light:
    'This founder wants support more than scrutiny right now. Give your view and help them move; raise a concern only when staying quiet would let them walk into something expensive. Explore the idea with them rather than stress-testing it.',
  balanced: '',
  hard: 'This founder wants to be pushed. Say where the plan is weakest and what you would need to believe for it to work. Name the assumption that has to hold. Still give your own position first — being challenged is useful, being interrogated is not.',
};

/**
 * Length is enforced structurally by `maxTokens` in voice mode; this sets the
 * intent, which is what actually shapes a reply. In practice advisors land
 * above whatever number they are given, so these read as targets rather than
 * limits.
 */
const LENGTH_GUIDANCE: Record<ReplyLength, string> = {
  brief: 'Keep replies to two or three sentences. Say the single most useful thing and stop.',
  standard: '',
  thorough:
    'This founder would rather have the reasoning than the headline. Take the space to show how you got there — a few short paragraphs, still without headings or bullet lists.',
};

const FORMALITY_GUIDANCE: Record<Formality, string> = {
  casual:
    'Talk the way colleagues who know each other do — first names, contractions, no throat-clearing.',
  neutral: '',
  formal:
    'Keep the register professional: complete sentences, no slang, the tone of a written board update spoken aloud.',
};

/** Free-text instructions are bounded so one profile cannot dominate every prompt. */
export const MAX_TEAM_INSTRUCTIONS_CHARS = 800;

/**
 * Builds the guidance block for a profile's settings, or an empty string when
 * nothing is configured.
 */
export function personalityGuidance(personality?: TeamPersonality | null): string {
  if (!personality) return '';

  const parts = [
    personality.challengeLevel ? CHALLENGE_GUIDANCE[personality.challengeLevel] : '',
    personality.replyLength ? LENGTH_GUIDANCE[personality.replyLength] : '',
    personality.formality ? FORMALITY_GUIDANCE[personality.formality] : '',
  ].filter(Boolean);

  const instructions = personality.teamInstructions?.trim();
  if (instructions) {
    // Last, and quoted as the founder's own words, so it is read as a
    // preference rather than as a fact about the business.
    parts.push(`The founder has also asked the team to work this way: "${instructions.slice(0, MAX_TEAM_INSTRUCTIONS_CHARS)}"`);
  }

  if (parts.length === 0) return '';

  return `\n\nHow this founder wants the team to work:\n\n${parts.join('\n\n')}`;
}
