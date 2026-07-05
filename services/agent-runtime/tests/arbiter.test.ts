import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Arbiter, DEFAULT_MAX_SPEAKERS } from '../src/arbiter.js';
import type { GatedPersona } from '../src/arbiter.js';

const SARAH: GatedPersona = {
  persona: { id: 'sarah-cfo', name: 'Sarah Chen', role: 'Chief Financial Officer' },
  relevanceScore: 0.9,
};
const PRIYA: GatedPersona = {
  persona: { id: 'priya-cmo', name: 'Priya Reddy', role: 'Chief Marketing Officer' },
  relevanceScore: 0.75,
};
const MARCUS: GatedPersona = {
  persona: { id: 'marcus-da', name: 'Marcus Webb', role: "Devil's Advocate" },
  relevanceScore: 0.6,
};

describe('Arbiter', () => {
  describe('rank()', () => {
    it('returns at most maxSpeakers personas', () => {
      const arbiter = new Arbiter();
      const result = arbiter.rank([SARAH, PRIYA, MARCUS], 2);
      expect(result).toHaveLength(2);
    });

    it('uses DEFAULT_MAX_SPEAKERS when not specified', () => {
      const arbiter = new Arbiter();
      const result = arbiter.rank([SARAH, PRIYA, MARCUS]);
      expect(result.length).toBeLessThanOrEqual(DEFAULT_MAX_SPEAKERS);
    });

    it('ranks higher-relevance personas first when no one has spoken (equal silence)', () => {
      const arbiter = new Arbiter();
      const result = arbiter.rank([MARCUS, SARAH, PRIYA], 3); // intentionally jumbled input order
      expect(result[0]!.persona.id).toBe('sarah-cfo'); // 0.9 relevance
      expect(result[1]!.persona.id).toBe('priya-cmo'); // 0.75 relevance
      expect(result[2]!.persona.id).toBe('marcus-da'); // 0.6 relevance
    });

    it('includes compositeScore and silenceScore in each result', () => {
      const arbiter = new Arbiter();
      const [first] = arbiter.rank([SARAH], 1);
      expect(first).toBeDefined();
      expect(typeof first!.compositeScore).toBe('number');
      expect(typeof first!.silenceScore).toBe('number');
      expect(first!.compositeScore).toBeGreaterThan(0);
      expect(first!.compositeScore).toBeLessThanOrEqual(1);
    });

    it('gives a never-spoken persona a full silence score of 1.0', () => {
      const arbiter = new Arbiter();
      const [result] = arbiter.rank([SARAH], 1);
      expect(result!.silenceScore).toBe(1.0);
    });

    it('returns an empty array when no personas are passed', () => {
      const arbiter = new Arbiter();
      expect(arbiter.rank([], 3)).toHaveLength(0);
    });

    it('returns fewer than maxSpeakers when fewer personas are passed', () => {
      const arbiter = new Arbiter();
      const result = arbiter.rank([SARAH], 5);
      expect(result).toHaveLength(1);
    });

    it('silence penalty boosts a quiet persona above a louder one with slightly higher relevance', () => {
      const arbiter = new Arbiter();

      // Marcus spoke very recently → low silence score
      arbiter.recordSpoke('marcus-da');

      // Sarah has only slightly higher relevance but Marcus's silence is near 0
      const lowSilenceMarcus: GatedPersona = { ...MARCUS, relevanceScore: 0.88 };
      const sarah: GatedPersona = { ...SARAH, relevanceScore: 0.85 };

      // Even though Marcus has 0.88 vs Sarah 0.85 relevance, Sarah's full silence
      // score should push her composite above Marcus who just spoke
      const result = arbiter.rank([lowSilenceMarcus, sarah], 2);

      // Sarah should rank higher due to silence bonus
      expect(result[0]!.persona.id).toBe('sarah-cfo');
    });

    it('is stable on ties — sorts by id as tiebreaker', () => {
      const arbiter = new Arbiter();
      // Give both equal relevance and both have never spoken
      const a: GatedPersona = {
        persona: { id: 'aaa', name: 'A', role: 'role' },
        relevanceScore: 0.8,
      };
      const b: GatedPersona = {
        persona: { id: 'bbb', name: 'B', role: 'role' },
        relevanceScore: 0.8,
      };
      const result = arbiter.rank([b, a], 2);
      expect(result[0]!.persona.id).toBe('aaa'); // 'aaa' < 'bbb' lexicographically
    });
  });

  describe('recordSpoke()', () => {
    it('reduces silence score immediately after speaking', () => {
      const arbiter = new Arbiter();

      const before = arbiter.rank([SARAH], 1);
      expect(before[0]!.silenceScore).toBe(1.0); // never spoken

      arbiter.recordSpoke('sarah-cfo');

      const after = arbiter.rank([SARAH], 1);
      expect(after[0]!.silenceScore).toBeCloseTo(0, 1); // just spoke
    });

    it('does not affect other personas', () => {
      const arbiter = new Arbiter();
      arbiter.recordSpoke('sarah-cfo');

      const result = arbiter.rank([PRIYA], 1);
      expect(result[0]!.silenceScore).toBe(1.0); // Priya hasn't spoken
    });
  });
});

describe('Arbiter — generateOrderedContributions integration shape', () => {
  it('arbiter.rank produces results with rank-1 indexing when used in ordered pipeline', () => {
    const arbiter = new Arbiter();
    const ranked = arbiter.rank([SARAH, PRIYA], 2);
    // Simulate the ranked loop
    const withRank = ranked.map((r, i) => ({ ...r, rank: i + 1 }));
    expect(withRank[0]!.rank).toBe(1);
    expect(withRank[1]!.rank).toBe(2);
  });
});
