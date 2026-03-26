import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionToken, getSessionCookieOptions, hashSessionToken } from "@/lib/auth/session";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("session utilities", () => {
  it("creates and hashes a session token", () => {
    const previousSessionSecret = process.env.SESSION_SECRET;

    try {
      process.env.SESSION_SECRET = "12345678901234567890123456789012";

      const token = createSessionToken();
      const tokenHash = hashSessionToken(token);
      const httpsCookieOptions = getSessionCookieOptions("https://lan.example");
      const httpCookieOptions = getSessionCookieOptions("http://192.168.1.20:3000");

      expect(token.length).toBeGreaterThan(20);
      expect(tokenHash).not.toBe(token);
      expect(httpsCookieOptions.secure).toBe(true);
      expect(httpCookieOptions.secure).toBe(false);
    } finally {
      if (previousSessionSecret === undefined) {
        delete process.env.SESSION_SECRET;
      } else {
        process.env.SESSION_SECRET = previousSessionSecret;
      }
    }
  });

  it("uses secure cookies by default in production when APP_URL is missing or invalid", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(getSessionCookieOptions("").secure).toBe(true);
    expect(getSessionCookieOptions("not-a-valid-url").secure).toBe(true);
    expect(getSessionCookieOptions("https://lan.example").secure).toBe(true);
    expect(getSessionCookieOptions("http://192.168.1.20:3000").secure).toBe(false);
  });
});
