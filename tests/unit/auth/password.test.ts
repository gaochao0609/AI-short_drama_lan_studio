import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password utilities", () => {
  it("hashes and verifies a password", async () => {
    const password = "P@ssw0rd!";
    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    await expect(verifyPassword(password, hash)).resolves.toBe(true);
  });

  it("returns false for an incorrect password", async () => {
    const hash = await hashPassword("P@ssw0rd!");

    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("rejects overlong passwords instead of allowing bcrypt truncation collisions", async () => {
    const suffixA = "A";
    const suffixB = "B";
    const overlongPasswordA = "a".repeat(72) + suffixA;
    const overlongPasswordB = "a".repeat(72) + suffixB;

    await expect(hashPassword(overlongPasswordA)).rejects.toThrow();

    const validHash = await hashPassword("safe-password");
    await expect(verifyPassword(overlongPasswordA, validHash)).resolves.toBe(false);
    await expect(verifyPassword(overlongPasswordB, validHash)).resolves.toBe(false);
  });
});
