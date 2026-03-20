import { afterEach, describe, expect, it, vi } from "vitest";

const processEnv = process.env as Record<string, string | undefined>;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalNodeEnv = process.env.NODE_ENV;

describe("database bootstrap", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@prisma/client");
    vi.doUnmock("@prisma/adapter-pg");

    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }

    if (originalNodeEnv === undefined) {
      delete processEnv.NODE_ENV;
    } else {
      processEnv.NODE_ENV = originalNodeEnv;
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

  it("reuses one prisma client instance across repeated property access in production", async () => {
    processEnv.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/ai_short_drama";

    const prismaClientConstructor = vi.fn(function PrismaClient() {
      return {
        user: { findMany: vi.fn() },
        session: { findMany: vi.fn() },
        $queryRaw: vi.fn(),
      };
    });
    const prismaAdapterConstructor = vi.fn(function PrismaPg() {
      return {};
    });

    vi.doMock("@prisma/client", () => ({
      PrismaClient: prismaClientConstructor,
    }));
    vi.doMock("@prisma/adapter-pg", () => ({
      PrismaPg: prismaAdapterConstructor,
    }));

    const mod = await import("@/lib/db");

    expect(mod.prisma.user).toBeDefined();
    expect(mod.prisma.session).toBeDefined();

    expect(prismaAdapterConstructor).toHaveBeenCalledTimes(1);
    expect(prismaClientConstructor).toHaveBeenCalledTimes(1);
  });
});
