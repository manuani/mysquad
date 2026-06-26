import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/index.js';

describe('loadConfig', () => {
  const baseEnv: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://u:p@localhost:5432/voai',
    NEO4J_URI: 'bolt://localhost:7687',
    NEO4J_USER: 'neo4j',
    NEO4J_PASSWORD: 'secret',
    REDIS_URL: 'redis://localhost:6379',
  };

  it('parses a valid environment', () => {
    const config = loadConfig(baseEnv);
    expect(config.env).toBe('test');
    expect(config.region).toBe('local');
    expect(config.logLevel).toBe('info');
    expect(config.port).toBe(3000);
  });

  it('throws on missing required env', () => {
    const incomplete: NodeJS.ProcessEnv = { ...baseEnv };
    delete incomplete.DATABASE_URL;
    expect(() => loadConfig(incomplete)).toThrow(/Invalid configuration/);
  });

  it('rejects an invalid logLevel', () => {
    expect(() => loadConfig({ ...baseEnv, LOG_LEVEL: 'verbose' })).toThrow(/Invalid configuration/);
  });
});
