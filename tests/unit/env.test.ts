import { describe, expect, it } from "vitest";
import { loadEnv } from "@/lib/env";

describe("loadEnv", () => {
  it("returns typed env config", () => {
    const env = loadEnv({
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/ai_short_drama",
      REDIS_URL: "redis://localhost:6379",
      APP_URL: "http://localhost:3000",
      SESSION_SECRET: "12345678901234567890123456789012",
    });

    expect(env.APP_URL).toBe("http://localhost:3000");
  });
});
