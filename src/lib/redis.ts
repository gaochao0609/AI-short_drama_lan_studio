import IORedis from "ioredis";
import { loadEnv } from "@/lib/env";

const { REDIS_URL } = loadEnv(process.env);

export const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
});
