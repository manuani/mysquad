import { describe, expect, it } from 'vitest';
import marketplaceModule from '../src/index.js';

describe('marketplace module', () => {
  it('exports a ModuleDefinition with the correct name', () => {
    expect(marketplaceModule.name).toBe('marketplace');
    expect(typeof marketplaceModule.register).toBe('function');
  });
});
