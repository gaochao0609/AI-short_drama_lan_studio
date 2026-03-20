import IORedis from "ioredis";
import type { ConnectionOptions } from "bullmq";

const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379";

export function getRedisUrl() {
  return process.env.REDIS_URL ?? DEFAULT_REDIS_URL;
}

export const connection = new IORedis(getRedisUrl(), {
  maxRetriesPerRequest: null,
});

export const bullmqConnection = {
  url: getRedisUrl(),
  maxRetriesPerRequest: null,
} satisfies ConnectionOptions;
