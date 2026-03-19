import { z } from "zod";

export const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  APP_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  STORAGE_ROOT: z.string().min(1),
  MAX_UPLOAD_MB: z.coerce.number().int().positive(),
  DEFAULT_ADMIN_USERNAME: z.string().min(1),
  DEFAULT_ADMIN_PASSWORD: z.string().min(8),
});

export type AppEnv = z.infer<typeof EnvSchema>;

export function loadEnv(input: Record<string, string | undefined>): AppEnv {
  return EnvSchema.parse(input);
}
