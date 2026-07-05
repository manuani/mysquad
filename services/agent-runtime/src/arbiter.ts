/**
 * Arbiter — decides which personas speak, in what order, and how many.
 *
 * Replaces the naive fan-out (everyone always speaks in parallel) with:
 *   1. A composite relevance + silence score per persona.
 *   2. A configurable max-speakers-per-turn cap (default 2 for speed).
 *   3. Sequential generation so persona N can reference persona N-1's answer.
 *
 * Silence penalty: a persona that hasn't spoken in a while gets a boost so
 * the same one doesn't dominate every turn. Decays linearly to zero after
 * SILENCE_FULL_SCORE_MINUTES minutes (30 by default).
 *
 * Score formula: relevanceScore × 0.65 + silenceScore × 0.35
 */

export interface ArbiterPersona {
  readonly id: string;
  readonly name: string;
  readonly role: string;
}

export interface GatedPersona {
  readonly persona: ArbiterPersona;
  readonly relevanceScore: number;
}

export interface RankedPersona extends GatedPersona {
  readonly compositeScore: number;
  readonly silenceScore: number;
}

const SILENCE_FULL_SCORE_MINUTES = 30;
const RELEVANCE_WEIGHT = 0.65;
const SILENCE_WEIGHT = 0.35;

export const DEFAULT_MAX_SPEAKERS = 2;
export const GATE_PASS_THRESHOLD = 0.4;

export class Arbiter {
  /** personaId → timestamp of last contribution (ms since epoch) */
  private readonly lastSpoke = new Map<string, number>();

  /** Record that a persona just contributed; updates silence tracking. */
  recordSpoke(personaId: string): void {
    this.lastSpoke.set(personaId, Date.now());
  }

  /**
   * Given all personas that passed the gate, rank them and return the top N
   * in order. Personas not in `gatedPersonas` (were skipped by gate) are
   * excluded.
   */
  rank(
    gatedPersonas: readonly GatedPersona[],
    maxSpeakers = DEFAULT_MAX_SPEAKERS,
  ): RankedPersona[] {
    const now = Date.now();

    const scored: RankedPersona[] = gatedPersonas.map(({ persona, relevanceScore }) => {
      const lastSpokeMs = this.lastSpoke.get(persona.id);
      const minutesSilent = lastSpokeMs ? (now - lastSpokeMs) / 60_000 : SILENCE_FULL_SCORE_MINUTES; // never spoken → max silence score

      const silenceScore = Math.min(minutesSilent / SILENCE_FULL_SCORE_MINUTES, 1.0);
      const compositeScore = relevanceScore * RELEVANCE_WEIGHT + silenceScore * SILENCE_WEIGHT;

      return { persona, relevanceScore, silenceScore, compositeScore };
    });

    // Sort descending by composite score, tie-break by persona id for stability
    scored.sort((a, b) =>
      b.compositeScore !== a.compositeScore
        ? b.compositeScore - a.compositeScore
        : a.persona.id.localeCompare(b.persona.id),
    );

    return scored.slice(0, maxSpeakers);
  }
}
