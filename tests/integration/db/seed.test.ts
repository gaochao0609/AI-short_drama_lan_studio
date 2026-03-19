import { execSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient, UserRole, UserStatus } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

const databaseUrl = "postgresql://postgres:postgres@localhost:5432/ai_short_drama";
const repoRoot = process.cwd();
const defaultModelKeys = ["script", "storyboard", "image", "video"] as const;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

afterAll(async () => {
  await prisma.$disconnect();
});

function runSeed(env: Record<string, string>) {
  execSync("pnpm db:seed", {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      ...env,
    },
    stdio: "pipe",
  });
}

describe("database seed", () => {
  it("does not overwrite existing admin credentials or provider settings on rerun", async () => {
    const adminUsername = `seed-admin-${Date.now()}`;
    const originalProviders = await prisma.modelProvider.findMany({
      where: { key: { in: [...defaultModelKeys] } },
    });
    const originalProvidersByKey = new Map(originalProviders.map((provider) => [provider.key, provider]));

    try {
      runSeed({
        DEFAULT_ADMIN_USERNAME: adminUsername,
        DEFAULT_ADMIN_PASSWORD: "initial-password",
      });

      const admin = await prisma.user.findUniqueOrThrow({
        where: { username: adminUsername },
      });
      await prisma.user.update({
        where: { id: admin.id },
        data: {
          passwordHash: "custom-password-hash",
          forcePasswordChange: false,
          role: UserRole.ADMIN,
          status: UserStatus.DISABLED,
        },
      });

      for (const key of defaultModelKeys) {
        await prisma.modelProvider.update({
          where: { key },
          data: {
            label: `${key}-custom-label`,
            providerName: `${key}-provider`,
            modelName: `${key}-model`,
            baseUrl: `https://${key}.example.test`,
            apiKey: `${key}-secret-ref`,
            configJson: { key, preserved: true },
            enabled: false,
          },
        });
      }

      runSeed({
        DEFAULT_ADMIN_USERNAME: adminUsername,
        DEFAULT_ADMIN_PASSWORD: "changed-default-password",
      });

      const rerunAdmin = await prisma.user.findUniqueOrThrow({
        where: { username: adminUsername },
      });
      expect(rerunAdmin.passwordHash).toBe("custom-password-hash");
      expect(rerunAdmin.forcePasswordChange).toBe(false);
      expect(rerunAdmin.status).toBe(UserStatus.DISABLED);

      const rerunProviders = await prisma.modelProvider.findMany({
        where: { key: { in: [...defaultModelKeys] } },
        orderBy: { key: "asc" },
      });
      expect(rerunProviders).toEqual(
        expect.arrayContaining(
          defaultModelKeys.map((key) =>
            expect.objectContaining({
              key,
              label: `${key}-custom-label`,
              providerName: `${key}-provider`,
              modelName: `${key}-model`,
              baseUrl: `https://${key}.example.test`,
              apiKey: `${key}-secret-ref`,
              configJson: { key, preserved: true },
              enabled: false,
            }),
          ),
        ),
      );
    } finally {
      await prisma.user.deleteMany({
        where: { username: adminUsername },
      });

      for (const key of defaultModelKeys) {
        const originalProvider = originalProvidersByKey.get(key);
        if (originalProvider) {
          await prisma.modelProvider.update({
            where: { key },
            data: {
              label: originalProvider.label,
              providerName: originalProvider.providerName,
              modelName: originalProvider.modelName,
              baseUrl: originalProvider.baseUrl,
              apiKey: originalProvider.apiKey,
              configJson:
                originalProvider.configJson === null
                  ? Prisma.JsonNull
                  : originalProvider.configJson,
              enabled: originalProvider.enabled,
            },
          });
        } else {
          await prisma.modelProvider.deleteMany({
            where: { key },
          });
        }
      }
    }
  });
});
