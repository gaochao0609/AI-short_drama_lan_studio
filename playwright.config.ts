import { defineConfig, devices } from "@playwright/test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/ai_short_drama";
process.env.APP_URL ??= "http://localhost:3000";
process.env.SESSION_SECRET ??= "12345678901234567890123456789012";
process.env.DEFAULT_ADMIN_USERNAME ??= "admin";
process.env.DEFAULT_ADMIN_PASSWORD ??= "replace-with-a-strong-password";
process.env.STORAGE_ROOT ??= "./storage";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
