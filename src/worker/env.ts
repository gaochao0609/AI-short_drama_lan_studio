const WORKER_ENV_DEFAULTS = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/ai_short_drama",
  DEFAULT_ADMIN_PASSWORD: "replace-with-a-strong-password",
  DEFAULT_ADMIN_USERNAME: "admin",
  MAX_UPLOAD_MB: "25",
  REDIS_URL: "redis://127.0.0.1:6379",
  SESSION_SECRET: "12345678901234567890123456789012",
  STORAGE_ROOT: "./storage",
} as const;

export function bootstrapWorkerEnv() {
  for (const [key, value] of Object.entries(WORKER_ENV_DEFAULTS)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
