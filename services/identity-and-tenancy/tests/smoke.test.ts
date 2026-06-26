import { describe, expect, it } from 'vitest';
import identityAndTenancyModule from '../src/index.js';

describe('identity-and-tenancy module', () => {
  it('exports a ModuleDefinition with the correct name', () => {
    expect(identityAndTenancyModule.name).toBe('identity-and-tenancy');
    expect(typeof identityAndTenancyModule.register).toBe('function');
  });
});
