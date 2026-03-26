import { afterEach, describe, expect, it } from "vitest";

const TEST_SESSION_SECRET = "12345678901234567890123456789012";

describe("provider secrets", () => {
  const previousSessionSecret = process.env.SESSION_SECRET;

  afterEach(() => {
    if (previousSessionSecret === undefined) {
      delete process.env.SESSION_SECRET;
      return;
    }

    process.env.SESSION_SECRET = previousSessionSecret;
  });

  it("derives an encryption key from SESSION_SECRET and round-trips api keys", async () => {
    process.env.SESSION_SECRET = TEST_SESSION_SECRET;

    const { decryptApiKey, deriveApiKeyEncryptionKey, encryptApiKey, maskApiKeyTail } = await import(
      "@/lib/security/secrets"
    );
    const derivedKey = deriveApiKeyEncryptionKey();
    const encrypted = encryptApiKey("sk-test-1234");

    expect(derivedKey).toHaveLength(32);
    expect(encrypted.apiKeyCiphertext).not.toBe("sk-test-1234");
    expect(encrypted.apiKeyMaskedTail).toBe(maskApiKeyTail("sk-test-1234"));
    expect(encrypted.apiKeyMaskedTail).toBe("****1234");
    expect(decryptApiKey(encrypted)).toBe("sk-test-1234");
  });
});
