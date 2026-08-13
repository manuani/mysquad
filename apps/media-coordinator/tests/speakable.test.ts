/**
 * Advisors are told not to use formatting in voice mode and mostly comply, but
 * emphasis still slips through — "what I *can* tell you" was observed live, and
 * the asterisks reach the voice.
 */

import { describe, expect, it } from 'vitest';
import { toSpeakable } from '../src/speakable.js';

describe('toSpeakable', () => {
  it('drops emphasis markers but keeps the word', () => {
    expect(toSpeakable('What I *can* tell you is this.')).toBe('What I can tell you is this.');
    expect(toSpeakable('That is **not** the question.')).toBe('That is not the question.');
    expect(toSpeakable('This is ***critical*** now.')).toBe('This is critical now.');
  });

  it('leaves arithmetic and possessives alone', () => {
    // A bare asterisk between numbers is multiplication, not emphasis.
    expect(toSpeakable('Roughly 3 * 4 seats.')).toBe('Roughly 3 * 4 seats.');
    expect(toSpeakable('The snake_case name stays.')).toBe('The snake_case name stays.');
  });

  it('turns a heading into a spoken sentence', () => {
    expect(toSpeakable('## The real question\nWhat are we building?')).toBe(
      'The real question. What are we building?',
    );
  });

  it('reads list items as separate sentences', () => {
    const input = '- First point\n- Second point\n- Third point';
    expect(toSpeakable(input)).toBe('First point. Second point. Third point.');
  });

  it('handles numbered lists', () => {
    expect(toSpeakable('1. Cut spend\n2. Raise a round')).toBe('Cut spend. Raise a round.');
  });

  it('says the link label, never the URL', () => {
    expect(toSpeakable('See [the pricing page](https://example.com/pricing).')).toBe(
      'See the pricing page.',
    );
  });

  it('keeps code contents without the backticks', () => {
    expect(toSpeakable('Set `runway` to six months.')).toBe('Set runway to six months.');
  });

  it('separates lines that would otherwise run together', () => {
    expect(toSpeakable('Six months of runway\nThat is tight')).toBe(
      'Six months of runway. That is tight.',
    );
  });

  it('does not double up existing punctuation', () => {
    expect(toSpeakable('Is that right?\nLet me know.')).toBe('Is that right? Let me know.');
  });

  it('removes blockquote and rule markers', () => {
    expect(toSpeakable('> A quoted line\n---\nAnd the next.')).toBe('A quoted line. And the next.');
  });

  it('collapses whitespace', () => {
    expect(toSpeakable('  spaced    out   text  ')).toBe('spaced out text.');
  });

  it('returns empty for empty input', () => {
    expect(toSpeakable('')).toBe('');
  });

  it('leaves clean prose untouched', () => {
    const clean = 'You have six months of runway. What are you trying to prove with it?';
    expect(toSpeakable(clean)).toBe(clean);
  });
});
