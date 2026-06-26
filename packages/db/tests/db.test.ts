import { describe, expect, it } from 'vitest';
import { createDatabaseClients, tenantObjectKey } from '../src/index.js';

describe('tenantObjectKey', () => {
  it('builds a tenant+session-scoped key', () => {
    expect(tenantObjectKey('tenant_1', 'recording.opus', 'session_1')).toBe(
      'tenant_1/session_1/recording.opus',
    );
  });

  it('builds a tenant-scoped key without a session', () => {
    expect(tenantObjectKey('tenant_1', 'export.json')).toBe('tenant_1/export.json');
  });
});

describe('createDatabaseClients', () => {
  it('wires all four clients without opening a connection', async () => {
    // No real Postgres/Neo4j/Redis/S3 endpoint is reachable here — this
    // verifies the contract is fully wired (every client present, `close`
    // is callable) without requiring live infrastructure. The connection
    // behaviour itself (withTenant, RLS enforcement) is covered by the
    // integration test in tests/integration/, which runs against the
    // Docker Compose stack.
    const db = createDatabaseClients({
      databaseUrl: 'postgres://voai:voai@localhost:5432/voai_dev',
      neo4jUri: 'bolt://localhost:7687',
      neo4jUser: 'neo4j',
      neo4jPassword: 'voai-dev-password',
      redisUrl: 'redis://localhost:6379',
      objectStoreBucket: 'voai-dev',
      objectStoreEndpoint: 'http://localhost:9000',
      objectStoreAccessKeyId: 'voai',
      objectStoreSecretAccessKey: 'voai-dev-password',
    });

    expect(db.postgres).toBeDefined();
    expect(db.neo4j).toBeDefined();
    expect(db.redis).toBeDefined();
    expect(db.objectStore).toBeDefined();
    expect(typeof db.close).toBe('function');

    await db.close();
  });
});
