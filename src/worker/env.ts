const WORKER_ENV_DEFAULTS = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/ai_short_drama",
  REDIS_URL: "redis://127.0.0.1:6379",
} as const;

export function bootstrapWorkerEnv() {
  for (const [key, value] of Object.entries(WORKER_ENV_DEFAULTS)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
