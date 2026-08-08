// Use the named `Redis` export rather than the default: ioredis ships CJS
// typings whose default resolves to a namespace, which cannot be used as a type.
import { Redis } from 'ioredis';

let _connection: Redis | undefined;

export function getRedisConnection(redisUrl: string): Redis {
  if (!_connection) {
    _connection = new Redis(redisUrl, {
      maxRetriesPerRequest: null, // required by BullMQ
      enableReadyCheck: false,
    });
  }
  return _connection;
}

export async function closeRedisConnection(): Promise<void> {
  if (_connection) {
    await _connection.quit();
    _connection = undefined;
  }
}
