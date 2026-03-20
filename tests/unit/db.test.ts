import { afterEach, describe, expect, it, vi } from "vitest";

const originalDatabaseUrl = process.env.DATABASE_URL;

describe("database bootstrap", () => {
  afterEach(() => {
    vi.resetModules();

    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it("allows importing the db module without DATABASE_URL during build-time evaluation", async () => {
    delete process.env.DATABASE_URL;

    const mod = await import("@/lib/db");

    expect(mod.prisma).toBeDefined();
  });

  it("throws only when the prisma client is actually used without DATABASE_URL", async () => {
    delete process.env.DATABASE_URL;

    const mod = await import("@/lib/db");

    expect(() => mod.prisma.$connect).toThrow("DATABASE_URL is required");
  });
});
