import { Prisma, UserRole, UserStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { readCommandFailure, runWorkspaceCommand, withTestDatabase } from "./test-database";

const defaultModelKeys = ["script", "storyboard", "image", "video"] as const;
function runSeed(databaseUrl: string, env: Record<string, string>) {
  runWorkspaceCommand("pnpm db:seed", {
    databaseUrl,
    env,
  });
}

describe("database seed", () => {
  it("requires DATABASE_URL to be set", () => {
    let failure: unknown;

    try {
      runWorkspaceCommand("pnpm db:seed", {
        omitDatabaseUrl: true,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeDefined();
    expect(readCommandFailure(failure)).toContain("DATABASE_URL");
  });

  it(
    "does not overwrite existing admin credentials or provider settings on rerun",
    async () => {
      await withTestDatabase(async ({ databaseUrl, prisma }) => {
        const adminUsername = `seed-admin-${Date.now()}`;
        const originalProviders = await prisma.modelProvider.findMany({
          where: { key: { in: [...defaultModelKeys] } },
        });
        const originalProvidersByKey = new Map(
          originalProviders.map((provider) => [provider.key, provider]),
        );

        try {
          runSeed(databaseUrl, {
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
                  apiKeyCiphertext: `${key}-ciphertext`,
                  apiKeyIv: `${key}-iv`,
                  apiKeyAuthTag: `${key}-tag`,
                  apiKeyMaskedTail: `****-${key.slice(-3)}`,
                  configJson: { key, preserved: true },
                  enabled: false,
                },
              });
          }

          runSeed(databaseUrl, {
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
                  apiKeyCiphertext: `${key}-ciphertext`,
                  apiKeyIv: `${key}-iv`,
                  apiKeyAuthTag: `${key}-tag`,
                  apiKeyMaskedTail: `****-${key.slice(-3)}`,
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
                  apiKeyCiphertext: originalProvider.apiKeyCiphertext,
                  apiKeyIv: originalProvider.apiKeyIv,
                  apiKeyAuthTag: originalProvider.apiKeyAuthTag,
                  apiKeyMaskedTail: originalProvider.apiKeyMaskedTail,
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
    },
    15_000,
  );
});
