import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

const requiredModels = [
  "users",
  "account_requests",
  "sessions",
  "projects",
  "script_sessions",
  "script_versions",
  "storyboard_versions",
  "assets",
  "tasks",
  "task_steps",
  "model_providers",
];

describe("database schema", () => {
  it("exposes the required models", async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/ai_short_drama";
    vi.resetModules();
    let prisma: PrismaClient | undefined;

    try {
      ({ prisma } = await import("@/lib/db"));
      const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename
        FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
      `;
      const tableNames = rows.map((row) => row.tablename);

      expect(tableNames).toEqual(expect.arrayContaining(requiredModels));
    } finally {
      if (prisma) {
        await prisma.$disconnect();
      }

      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });
});
