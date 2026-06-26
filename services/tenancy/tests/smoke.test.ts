import { describe, expect, it } from 'vitest';
import tenancyModule from '../src/index.js';

describe('tenancy module', () => {
  it('exports a ModuleDefinition with the correct name', () => {
    expect(tenancyModule.name).toBe('tenancy');
    expect(typeof tenancyModule.register).toBe('function');
  });
});
