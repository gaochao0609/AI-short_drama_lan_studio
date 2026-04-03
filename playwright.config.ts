import { defineConfig, devices } from "@playwright/test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/ai_short_drama";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.APP_URL ??= "http://localhost:3000";
process.env.SESSION_SECRET ??= "12345678901234567890123456789012";
process.env.DEFAULT_ADMIN_USERNAME ??= "admin";
process.env.DEFAULT_ADMIN_PASSWORD ??= "replace-with-a-strong-password";
process.env.STORAGE_ROOT ??= "./storage";

const appUrl = new URL(process.env.APP_URL);
const appPort = appUrl.port || (appUrl.protocol === "https:" ? "443" : "80");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  use: {
    baseURL: process.env.APP_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm dev --port ${appPort}`,
    url: process.env.APP_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
