import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Client } from "pg";

const repoRoot = process.cwd();
const baseDatabaseUrl = "postgresql://postgres:postgres@localhost:5432/ai_short_drama";

type CommandOptions = {
  databaseUrl?: string;
  env?: Record<string, string>;
  omitDatabaseUrl?: boolean;
};

export type TestDatabaseContext = {
  databaseName: string;
  databaseUrl: string;
  prisma: PrismaClient;
};

function getAdminDatabaseUrl() {
  const url = new URL(baseDatabaseUrl);
  url.pathname = "/postgres";
  return url.toString();
}

function getTestDatabaseUrl(databaseName: string) {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function readCommandFailure(error: unknown) {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const execError = error as Error & {
    stdout?: Buffer | string;
    stderr?: Buffer | string;
  };

  const stdout =
    typeof execError.stdout === "string"
      ? execError.stdout
      : execError.stdout?.toString("utf8") ?? "";
  const stderr =
    typeof execError.stderr === "string"
      ? execError.stderr
      : execError.stderr?.toString("utf8") ?? "";

  return [execError.message, stdout, stderr].filter(Boolean).join("\n");
}

export function runWorkspaceCommand(command: string, options: CommandOptions = {}) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
  };

  if (options.omitDatabaseUrl) {
    delete env.DATABASE_URL;
  } else if (options.databaseUrl) {
    env.DATABASE_URL = options.databaseUrl;
  }

  return execSync(command, {
    cwd: repoRoot,
    env,
    stdio: "pipe",
    encoding: "utf8",
  });
}

async function createDatabase(databaseName: string) {
  const client = new Client({ connectionString: getAdminDatabaseUrl() });

  try {
    await client.connect();
    await client.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  } finally {
    await client.end();
  }
}

async function dropDatabase(databaseName: string) {
  const client = new Client({ connectionString: getAdminDatabaseUrl() });

  try {
    await client.connect();
    await client.query(
      `
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1
          AND pid <> pg_backend_pid()
      `,
      [databaseName],
    );
    await client.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  } finally {
    await client.end();
  }
}

export async function withTestDatabase<T>(
  callback: (context: TestDatabaseContext) => Promise<T>,
  options: { seed?: boolean; seedEnv?: Record<string, string> } = {},
) {
  const databaseName = `task3_${randomUUID().replaceAll("-", "")}`.toLowerCase();
  const databaseUrl = getTestDatabaseUrl(databaseName);

  await createDatabase(databaseName);

  try {
    runWorkspaceCommand("pnpm prisma migrate deploy", { databaseUrl });

    if (options.seed) {
      runWorkspaceCommand("pnpm db:seed", {
        databaseUrl,
        env: options.seedEnv,
      });
    }

    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    });

    try {
      return await callback({
        databaseName,
        databaseUrl,
        prisma,
      });
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    await dropDatabase(databaseName);
  }
}

export async function withEmptyTestDatabase<T>(
  callback: (context: Omit<TestDatabaseContext, "prisma">) => Promise<T>,
) {
  const databaseName = `task3_${randomUUID().replaceAll("-", "")}`.toLowerCase();
  const databaseUrl = getTestDatabaseUrl(databaseName);

  await createDatabase(databaseName);

  try {
    return await callback({
      databaseName,
      databaseUrl,
    });
  } finally {
    await dropDatabase(databaseName);
  }
}
