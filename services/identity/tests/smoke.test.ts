import { describe, expect, it } from 'vitest';
import identityModule from '../src/index.js';

describe('identity module', () => {
  it('exports a ModuleDefinition with the correct name', () => {
    expect(identityModule.name).toBe('identity');
    expect(typeof identityModule.register).toBe('function');
  });
});
