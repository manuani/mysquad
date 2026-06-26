import { describe, expect, it } from 'vitest';
import { createDatabaseClients } from '../src/index.js';

describe('db package contract', () => {
  it('createDatabaseClients throws until Sprint 1.1.2 implements wiring', () => {
    expect(() =>
      createDatabaseClients({
        databaseUrl: 'postgres://x',
        neo4jUri: 'bolt://x',
        neo4jUser: 'u',
        neo4jPassword: 'p',
        redisUrl: 'redis://x',
      }),
    ).toThrow(/Sprint 1\.1\.2/);
  });
});
