import { describe, expect, it } from 'vitest';
import brainModule from '../src/index.js';

describe('brain module', () => {
  it('exports a ModuleDefinition with the correct name', () => {
    expect(brainModule.name).toBe('brain');
    expect(typeof brainModule.register).toBe('function');
  });
});
