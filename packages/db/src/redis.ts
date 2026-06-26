import { Redis } from 'ioredis';
import type { RedisClient } from './index.js';

/**
 * Real `RedisClient` backed by `ioredis`.
 *
 * Per System Architecture §4.2.4, keys are tenant-prefixed
 * (`tenant:{tenantId}:session:{sessionId}:state`) — this client does not
 * enforce that prefix itself (Redis has no RLS equivalent to fail closed
 * on); callers build tenant-scoped keys explicitly.
 *
 * `ioredis`'s `set` is heavily overloaded (variadic mode flags, GET/NX/XX
 * combinations) in a way that doesn't structurally match our narrower
 * `RedisClient` surface, so this wraps the three methods explicitly
 * rather than casting the whole client.
 */
export function createRedisClient(redisUrl: string): {
  client: RedisClient;
  close: () => Promise<void>;
} {
  // lazyConnect: the connection opens on first command, not at construction.
  // This keeps createDatabaseClients() side-effect-free until something
  // actually issues a Redis command — important for unit tests that wire
  // the contract without a live Redis instance.
  const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 3 });

  const client: RedisClient = {
    get: (key) => redis.get(key),
    set: (key, value, mode, ttlSeconds) =>
      mode && ttlSeconds !== undefined
        ? redis.set(key, value, mode, ttlSeconds)
        : redis.set(key, value),
    del: (key) => redis.del(key),
  };

  return { client, close: () => redis.quit().then(() => undefined) };
}
