import { describe, expect, it } from 'vitest';
import performanceModule from '../src/index.js';

describe('performance module', () => {
  it('exports a ModuleDefinition with the correct name', () => {
    expect(performanceModule.name).toBe('performance');
    expect(typeof performanceModule.register).toBe('function');
  });
});
