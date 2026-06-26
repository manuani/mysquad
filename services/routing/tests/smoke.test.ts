import { describe, expect, it } from 'vitest';
import routingModule from '../src/index.js';

describe('routing module', () => {
  it('exports a ModuleDefinition with the correct name', () => {
    expect(routingModule.name).toBe('routing');
    expect(typeof routingModule.register).toBe('function');
  });
});
