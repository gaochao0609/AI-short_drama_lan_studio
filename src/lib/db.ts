import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaConnectionString?: string;
};
let prismaClient: PrismaClient | undefined;
let prismaClientConnectionString: string | undefined;

function getConnectionString() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  return connectionString;
}

function getPrismaClient() {
  const connectionString = getConnectionString();

  if (process.env.NODE_ENV !== "production") {
    if (
      globalForPrisma.prisma &&
      globalForPrisma.prismaConnectionString === connectionString
    ) {
      return globalForPrisma.prisma;
    }
  }

  if (prismaClient && prismaClientConnectionString === connectionString) {
    return prismaClient;
  }

  prismaClient = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  prismaClientConnectionString = connectionString;

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prismaClient;
    globalForPrisma.prismaConnectionString = connectionString;
  }

  return prismaClient;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property);

    return typeof value === "function" ? value.bind(client) : value;
  },
});

export async function waitForDatabase(maxAttempts = 10) {
  const client = getPrismaClient();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await client.$queryRaw`SELECT 1`;
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
}
