/**
 * Architecture §5.6 requires the model to be chosen by the customer's tier
 * *and the task's complexity*. Only the plan half was implemented, so every
 * question looked identical to the router.
 */

import { describe, expect, it } from 'vitest';
import { classifyComplexity } from '../src/classify-complexity.js';

const band = (message: string, domain?: string) =>
  classifyComplexity(domain ? { message, domain } : { message }).complexity;

describe('classifyComplexity', () => {
  it('treats a strategic funding question as complex', () => {
    expect(band('Should we cut the marketing budget or raise a bridge round?')).toBe('complex');
  });

  it('treats a runway question with a material figure as complex', () => {
    expect(band('We are burning $40,000 a month with six months of runway left.')).toBe('complex');
  });

  it('treats a definition lookup as routine', () => {
    expect(band('What is ARR?')).toBe('routine');
  });

  it('treats a pleasantry as routine', () => {
    expect(band('Thanks, that helps.')).toBe('routine');
  });

  it('defaults to standard when nothing signals either way', () => {
    const result = classifyComplexity({ message: 'Tell me about the team we hired last quarter.' });
    expect(result.complexity).toBe('standard');
    expect(result.reasons).toContain('no signal — default');
  });

  it('escalates on a high-stakes brain domain', () => {
    // Domain alone is one signal → standard; with a second it reaches complex.
    expect(band('Where do we stand?', 'financial_state')).toBe('standard');
    expect(band('Should we change course?', 'financial_state')).toBe('complex');
  });

  it('honours a caller-specified band without inspecting the text', () => {
    // The relevance gate emits a fixed ~80 token verdict however hard the
    // question being judged is; classifying its prompt would size the model to
    // the question rather than to the judging.
    const result = classifyComplexity({
      message: 'Should we raise a Series A at a $40M valuation or restructure?',
      complexity: 'routine',
    });
    expect(result.complexity).toBe('routine');
    expect(result.reasons).toEqual(['caller-specified']);
  });

  describe('monetary thresholds', () => {
    it.each([
      ['$40,000 burn', true],
      ['40k in the bank', true],
      ['₹50 lakh raise', true],
      ['2 crore valuation', true],
      ['$500 for the office plants', false],
    ])('%s → material: %s', (text, material) => {
      const reasons = classifyComplexity({ message: text }).reasons;
      expect(reasons.includes('material amount')).toBe(material);
    });

    it('does not read a bare count as money', () => {
      // "3 engineers" is not $3 — requires a currency symbol or a scale word.
      const reasons = classifyComplexity({ message: 'We have 30000 users now.' }).reasons;
      expect(reasons).not.toContain('material amount');
    });
  });

  it('prefers complex when signals conflict', () => {
    // Mistaking a hard question for an easy one gives a worse answer; the
    // reverse only costs money. The asymmetry is deliberate.
    expect(band('What is our runway if we raise a bridge round at $2M?')).toBe('complex');
  });
});
