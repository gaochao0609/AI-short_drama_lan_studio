import IORedis from "ioredis";
import type { ConnectionOptions } from "bullmq";

const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379";

export function getRedisUrl() {
  return process.env.REDIS_URL ?? DEFAULT_REDIS_URL;
}

export const bullmqConnection = {
  url: getRedisUrl(),
  maxRetriesPerRequest: null,
} satisfies ConnectionOptions;

let _redisClient: IORedis | null = null;

/**
 * Returns a lazily-initialized IORedis client. Intended for test cleanup
 * (e.g. flushdb) and ad-hoc use — production code should use bullmqConnection.
 */
export function getRedisClient(): IORedis {
  if (!_redisClient) {
    _redisClient = new IORedis(getRedisUrl(), {
      maxRetriesPerRequest: null,
    });
  }
  return _redisClient;
}
