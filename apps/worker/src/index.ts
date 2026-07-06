/**
 * Worker process entrypoint.
 *
 * Boots config → Redis → Postgres + Neo4j (via @voai/db) → BullMQ workers.
 * Handles SIGTERM/SIGINT for graceful shutdown so in-flight jobs are
 * allowed to complete before the process exits.
 */

import { loadConfig } from '@voai/config';
import { createDatabaseClients } from '@voai/db';
import { getRedisConnection, closeRedisConnection } from './redis.js';
import { startWorkers } from './worker.js';

const config = loadConfig();

const log = {
  debug: (...args: unknown[]) => console.debug('[worker]', ...args),
  info: (...args: unknown[]) => console.info('[worker]', ...args),
  warn: (...args: unknown[]) => console.warn('[worker]', ...args),
  error: (...args: unknown[]) => console.error('[worker]', ...args),
  child: (meta: Record<string, unknown>) => ({
    debug: (...args: unknown[]) => console.debug('[worker]', meta, ...args),
    info: (...args: unknown[]) => console.info('[worker]', meta, ...args),
    warn: (...args: unknown[]) => console.warn('[worker]', meta, ...args),
    error: (...args: unknown[]) => console.error('[worker]', meta, ...args),
    child: (m2: Record<string, unknown>) => log.child({ ...meta, ...m2 }),
  }),
};

const db = createDatabaseClients({
  databaseUrl: config.databaseUrl,
  redisUrl: config.redisUrl,
  neo4jUri: config.neo4jUri,
  neo4jUser: config.neo4jUser,
  neo4jPassword: config.neo4jPassword,
  objectStoreBucket: config.objectStoreBucket,
  objectStoreRegion: config.objectStoreRegion,
  objectStoreEndpoint: config.objectStoreEndpoint,
  objectStoreAccessKeyId: config.objectStoreAccessKeyId,
  objectStoreSecretAccessKey: config.objectStoreSecretAccessKey,
});

// Separate ioredis connection for BullMQ (requires maxRetriesPerRequest: null)
const bullRedis = getRedisConnection(config.redisUrl);

const workers = startWorkers({
  connection: bullRedis as import('ioredis').default,
  postgres: db.postgres,
  neo4j: db.neo4j,
  log,
});

async function shutdown(signal: string): Promise<void> {
  log.info('shutdown signal received', { signal });
  await workers.close();
  await db.close();
  await closeRedisConnection();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

log.info('worker process ready', {
  env: config.env,
  redis: config.redisUrl.replace(/\/\/.*@/, '//***@'),
});
