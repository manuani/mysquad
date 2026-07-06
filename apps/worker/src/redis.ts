import IORedis from 'ioredis';

let _connection: IORedis | undefined;

export function getRedisConnection(redisUrl: string): IORedis {
  if (!_connection) {
    _connection = new IORedis(redisUrl, {
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
