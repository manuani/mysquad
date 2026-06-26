import { describe, expect, it } from 'vitest';
import ledgerModule from '../src/index.js';

describe('ledger module', () => {
  it('exports a ModuleDefinition with the correct name', () => {
    expect(ledgerModule.name).toBe('ledger');
    expect(typeof ledgerModule.register).toBe('function');
  });
});
