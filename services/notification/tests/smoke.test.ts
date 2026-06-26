import { describe, expect, it } from 'vitest';
import notificationModule from '../src/index.js';

describe('notification module', () => {
  it('exports a ModuleDefinition with the correct name', () => {
    expect(notificationModule.name).toBe('notification');
    expect(typeof notificationModule.register).toBe('function');
  });
});
