import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaClientConstructor, prismaAdapterConstructor } = vi.hoisted(() => ({
  prismaClientConstructor: vi.fn(),
  prismaAdapterConstructor: vi.fn(),
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: prismaClientConstructor,
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: prismaAdapterConstructor,
}));

const processEnv = process.env as Record<string, string | undefined>;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalNodeEnv = process.env.NODE_ENV;
const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: unknown;
  prismaConnectionString?: string;
};

describe("database bootstrap", () => {
  beforeEach(() => {
    prismaClientConstructor.mockReset();
    prismaClientConstructor.mockImplementation(function PrismaClient() {
      return {
        user: { findMany: vi.fn() },
        session: { findMany: vi.fn() },
        $connect: vi.fn(),
        $queryRaw: vi.fn(),
      };
    });

    prismaAdapterConstructor.mockReset();
    prismaAdapterConstructor.mockImplementation(function PrismaPg() {
      return {};
    });
  });

  afterEach(() => {
    vi.resetModules();
    delete globalForPrisma.prisma;
    delete globalForPrisma.prismaConnectionString;

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

    const mod = await import("@/lib/db");

    expect(mod.prisma.user).toBeDefined();
    expect(mod.prisma.session).toBeDefined();

    expect(prismaAdapterConstructor).toHaveBeenCalledTimes(1);
    expect(prismaClientConstructor).toHaveBeenCalledTimes(1);
  });
});
