/**
 * Regression tests for the failure seen in the meeting UI: the founder said
 * "Hello, Sarah" and Sarah did not answer — Marcus and Priya did, each opening
 * by explaining that Sarah Chen is the CFO.
 */

import { describe, expect, it } from 'vitest';
import { analyseAddress } from '../src/address.js';
import { Arbiter } from '../src/arbiter.js';

const PERSONAS = [
  { id: 'sarah-cfo', name: 'Sarah Chen' },
  { id: 'priya-cmo', name: 'Priya Reddy' },
  { id: 'marcus-da', name: 'Marcus Webb' },
];

describe('analyseAddress', () => {
  it('detects a persona greeted by first name', () => {
    const a = analyseAddress('Hello, Sarah.', PERSONAS);
    expect(a.addressed).toEqual(['sarah-cfo']);
    expect(a.isSocial).toBe(true);
  });

  it('detects several personas named in one turn', () => {
    const a = analyseAddress('Hello, Priya. Hello, Marcus. How are you guys doing today?', PERSONAS);
    expect(a.addressed).toEqual(expect.arrayContaining(['priya-cmo', 'marcus-da']));
    expect(a.addressed).not.toContain('sarah-cfo');
    expect(a.isSocial).toBe(true);
    expect(a.addressesRoom).toBe(true);
  });

  it('matches full names as well as first names', () => {
    expect(analyseAddress('Sarah Chen, can you look at this?', PERSONAS).addressed).toEqual(['sarah-cfo']);
  });

  it('treats a greeting attached to a real question as work', () => {
    // "Hi Sarah, what's our runway?" is a request with a greeting on the front.
    const a = analyseAddress("Hi Sarah, what's our runway looking like?", PERSONAS);
    expect(a.addressed).toEqual(['sarah-cfo']);
    expect(a.isSocial).toBe(false);
  });

  it('does not treat a substantive question as social', () => {
    const a = analyseAddress('Should we cut marketing or raise a bridge round?', PERSONAS);
    expect(a.isSocial).toBe(false);
    expect(a.addressed).toEqual([]);
  });

  it('does not match a name inside an unrelated word', () => {
    // "Mark" must not match "marketing", and no persona is named here.
    expect(analyseAddress('What is our marketing spend this quarter?', PERSONAS).addressed).toEqual([]);
  });

  it('recognises thanks and sign-offs as social', () => {
    expect(analyseAddress('Thanks, that helps.', PERSONAS).isSocial).toBe(true);
  });

  it('recognises the room being addressed generally', () => {
    const a = analyseAddress('Morning everyone, how are things?', PERSONAS);
    expect(a.addressesRoom).toBe(true);
    expect(a.isSocial).toBe(true);
    expect(a.addressed).toEqual([]);
  });
});

describe('Arbiter ranking with direct address', () => {
  const gated = [
    { persona: { id: 'sarah-cfo', name: 'Sarah Chen', role: 'CFO' }, relevanceScore: 0.5 },
    { persona: { id: 'priya-cmo', name: 'Priya Reddy', role: 'CMO' }, relevanceScore: 0.5 },
    { persona: { id: 'marcus-da', name: 'Marcus Webb', role: "Devil's Advocate" }, relevanceScore: 0.5 },
  ];

  it('answers the person who was named', () => {
    // The original bug: equal scores fell through to the alphabetical
    // tie-break, so 'marcus-da' and 'priya-cmo' took both speaker slots and
    // 'sarah-cfo' — the one greeted — was cut.
    const ranked = new Arbiter().rank(gated, 2, ['sarah-cfo']);
    expect(ranked[0]!.persona.id).toBe('sarah-cfo');
  });

  it('still excluded the addressed persona before the fix', () => {
    // Same inputs with no address information reproduces the old behaviour,
    // which is what made the bug visible in the UI.
    const ranked = new Arbiter().rank(gated, 2);
    expect(ranked.map((r) => r.persona.id)).toEqual(['marcus-da', 'priya-cmo']);
  });

  it('never cuts someone who was named, even past the speaker cap', () => {
    const ranked = new Arbiter().rank(gated, 1, ['priya-cmo', 'marcus-da']);
    const ids = ranked.map((r) => r.persona.id);
    expect(ids).toContain('priya-cmo');
    expect(ids).toContain('marcus-da');
  });

  it('falls back to score order when nobody is named', () => {
    const scored = [
      { persona: { id: 'sarah-cfo', name: 'Sarah Chen', role: 'CFO' }, relevanceScore: 0.9 },
      { persona: { id: 'marcus-da', name: 'Marcus Webb', role: "DA" }, relevanceScore: 0.2 },
    ];
    expect(new Arbiter().rank(scored, 1)[0]!.persona.id).toBe('sarah-cfo');
  });
});
