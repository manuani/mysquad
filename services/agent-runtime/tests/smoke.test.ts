import { describe, expect, it } from 'vitest';
import agent_runtimeModule from '../src/index.js';

describe('agent-runtime module', () => {
  it('exports a ModuleDefinition with the correct name', () => {
    expect(agent_runtimeModule.name).toBe('agent-runtime');
    expect(typeof agent_runtimeModule.register).toBe('function');
  });
});
