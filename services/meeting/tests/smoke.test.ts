import { describe, expect, it } from 'vitest';
import meetingModule from '../src/index.js';

describe('meeting module', () => {
  it('exports a ModuleDefinition with the correct name', () => {
    expect(meetingModule.name).toBe('meeting');
    expect(typeof meetingModule.register).toBe('function');
  });
});
