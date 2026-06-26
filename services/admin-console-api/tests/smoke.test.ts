import { describe, expect, it } from 'vitest';
import admin_console_apiModule from '../src/index.js';

describe('admin-console-api module', () => {
  it('exports a ModuleDefinition with the correct name', () => {
    expect(admin_console_apiModule.name).toBe('admin-console-api');
    expect(typeof admin_console_apiModule.register).toBe('function');
  });
});
