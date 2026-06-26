import { describe, expect, it } from 'vitest';
import marketplace_meteringModule from '../src/index.js';

describe('marketplace-metering module', () => {
  it('exports a ModuleDefinition with the correct name', () => {
    expect(marketplace_meteringModule.name).toBe('marketplace-metering');
    expect(typeof marketplace_meteringModule.register).toBe('function');
  });
});
