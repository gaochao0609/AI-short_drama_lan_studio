import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const API_KEY_ENCRYPTION_INFO = "api-key-encryption";

export type EncryptedApiKey = {
  apiKeyCiphertext: string;
  apiKeyIv: string;
  apiKeyAuthTag: string;
  apiKeyMaskedTail: string;
};

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error("SESSION_SECRET is required");
  }

  return secret;
}

export function deriveApiKeyEncryptionKey() {
  return Buffer.from(
    hkdfSync("sha256", getSessionSecret(), Buffer.alloc(0), API_KEY_ENCRYPTION_INFO, 32),
  );
}

export function maskApiKeyTail(apiKey: string) {
  return `****${apiKey.slice(-4)}`;
}

export function encryptApiKey(apiKey: string): EncryptedApiKey {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveApiKeyEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    apiKeyCiphertext: ciphertext.toString("base64"),
    apiKeyIv: iv.toString("base64"),
    apiKeyAuthTag: authTag.toString("base64"),
    apiKeyMaskedTail: maskApiKeyTail(apiKey),
  };
}

export function decryptApiKey(input: {
  apiKeyCiphertext: string;
  apiKeyIv: string;
  apiKeyAuthTag: string;
}) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveApiKeyEncryptionKey(),
    Buffer.from(input.apiKeyIv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(input.apiKeyAuthTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(input.apiKeyCiphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
