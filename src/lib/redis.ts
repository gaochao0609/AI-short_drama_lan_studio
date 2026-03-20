import IORedis from "ioredis";
import type { ConnectionOptions } from "bullmq";
import { loadEnv } from "@/lib/env";

const { REDIS_URL } = loadEnv(process.env);

export const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const bullmqConnection = {
  url: REDIS_URL,
  maxRetriesPerRequest: null,
} satisfies ConnectionOptions;
