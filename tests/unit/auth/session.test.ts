import { describe, expect, it } from "vitest";
import { createSessionToken, hashSessionToken } from "@/lib/auth/session";

describe("session utilities", () => {
  it("creates and hashes a session token", () => {
    const previousSessionSecret = process.env.SESSION_SECRET;

    try {
      process.env.SESSION_SECRET = "12345678901234567890123456789012";

      const token = createSessionToken();
      const tokenHash = hashSessionToken(token);

      expect(token.length).toBeGreaterThan(20);
      expect(tokenHash).not.toBe(token);
    } finally {
      if (previousSessionSecret === undefined) {
        delete process.env.SESSION_SECRET;
      } else {
        process.env.SESSION_SECRET = previousSessionSecret;
      }
    }
  });
});
