import { UserRole, UserStatus } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTestDatabase } from "../db/test-database";
import {
  hashPasswordForTest,
  insertSessionForUser,
  jsonRequest,
  loadRouteModule,
  withApiTestEnv,
} from "./test-api";

afterEach(() => {
  vi.doUnmock("next/headers");
  vi.resetModules();
});

describe("admin providers api", () => {
  it("allows an admin to create and update provider configs", async () => {
    await withTestDatabase(
      async ({ databaseUrl, prisma }) => {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const admin = await prisma.user.update({
              where: { username: "admin-providers-tests" },
              data: { forcePasswordChange: false },
            });
            const adminSession = await insertSessionForUser(prisma, admin.id);
            const { POST, PATCH } = await loadRouteModule<{
              POST: (request: Request) => Promise<Response>;
              PATCH: (request: Request) => Promise<Response>;
            }>("src/app/api/admin/providers/route.ts", {
              sessionToken: adminSession.token,
            });

            const createResponse = await POST(
              jsonRequest(
                "http://localhost/api/admin/providers",
                {
                  key: "script-premium",
                  label: "Script Premium",
                  providerName: "openai-proxy",
                  modelName: "gpt-4.1",
                  baseUrl: "https://proxy.example.com/v1",
                  apiKey: "secret-token",
                  timeoutMs: 45000,
                  maxRetries: 3,
                  enabled: true,
                  configJson: {
                    defaultForTasks: ["script_question_generate", "script_finalize"],
                  },
                },
                { method: "POST" },
              ),
            );

            expect(createResponse.status).toBe(201);
            await expect(createResponse.json()).resolves.toEqual({
              provider: expect.objectContaining({
                key: "script-premium",
                providerName: "openai-proxy",
                modelName: "gpt-4.1",
                timeoutMs: 45000,
                maxRetries: 3,
                enabled: true,
                configJson: {
                  defaultForTasks: ["script_question_generate", "script_finalize"],
                },
              }),
            });

            const updateResponse = await PATCH(
              jsonRequest(
                "http://localhost/api/admin/providers",
                {
                  key: "script-premium",
                  label: "Script Premium Updated",
                  modelName: "gpt-4.1-mini",
                  timeoutMs: 60000,
                  enabled: false,
                  configJson: {
                    defaultForTasks: ["script_finalize"],
                  },
                },
                { method: "PATCH" },
              ),
            );

            expect(updateResponse.status).toBe(200);
            await expect(updateResponse.json()).resolves.toEqual({
              provider: expect.objectContaining({
                key: "script-premium",
                label: "Script Premium Updated",
                modelName: "gpt-4.1-mini",
                timeoutMs: 60000,
                enabled: false,
                configJson: {
                  defaultForTasks: ["script_finalize"],
                },
              }),
            });

            await expect(
              prisma.modelProvider.findUniqueOrThrow({
                where: { key: "script-premium" },
              }),
            ).resolves.toEqual(
              expect.objectContaining({
                key: "script-premium",
                label: "Script Premium Updated",
                modelName: "gpt-4.1-mini",
                timeoutMs: 60000,
                enabled: false,
              }),
            );
          },
          {
            DEFAULT_ADMIN_PASSWORD: "AdminPass123!",
            DEFAULT_ADMIN_USERNAME: "admin-providers-tests",
          },
        );
      },
      {
        seed: true,
        seedEnv: {
          DEFAULT_ADMIN_PASSWORD: "AdminPass123!",
          DEFAULT_ADMIN_USERNAME: "admin-providers-tests",
        },
      },
    );
  });

  it("rejects non-admin access", async () => {
    await withTestDatabase(
      async ({ databaseUrl, prisma }) => {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const passwordHash = await hashPasswordForTest("UserPass123!");
            const user = await prisma.user.create({
              data: {
                username: "regular-provider-user",
                passwordHash,
                role: UserRole.USER,
                status: UserStatus.ACTIVE,
                forcePasswordChange: false,
              },
            });
            const session = await insertSessionForUser(prisma, user.id);
            const { GET } = await loadRouteModule<{
              GET: () => Promise<Response>;
            }>("src/app/api/admin/providers/route.ts", {
              sessionToken: session.token,
            });

            const response = await GET();

            expect(response.status).toBe(403);
            await expect(response.json()).resolves.toEqual({
              error: "Forbidden",
            });
          },
          {
            DEFAULT_ADMIN_PASSWORD: "AdminPass123!",
            DEFAULT_ADMIN_USERNAME: "admin-providers-tests",
          },
        );
      },
      {
        seed: true,
        seedEnv: {
          DEFAULT_ADMIN_PASSWORD: "AdminPass123!",
          DEFAULT_ADMIN_USERNAME: "admin-providers-tests",
        },
      },
    );
  });

  it("returns providers and default models for each task pipeline", async () => {
    await withTestDatabase(
      async ({ databaseUrl, prisma }) => {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const admin = await prisma.user.update({
              where: { username: "admin-providers-tests" },
              data: { forcePasswordChange: false },
            });
            await prisma.modelProvider.update({
              where: { key: "script" },
              data: {
                label: "Script Default",
                providerName: "proxy-openai",
                modelName: "gpt-4.1-mini",
                baseUrl: "https://proxy.example.com/script",
                configJson: {
                  defaultForTasks: ["script_question_generate", "script_finalize"],
                },
              },
            });
            await prisma.modelProvider.update({
              where: { key: "storyboard" },
              data: {
                label: "Storyboard Default",
                providerName: "proxy-openai",
                modelName: "gpt-4.1-mini",
                configJson: {
                  defaultForTasks: ["storyboard_split"],
                },
              },
            });
            await prisma.modelProvider.update({
              where: { key: "image" },
              data: {
                label: "Image Default",
                providerName: "proxy-image",
                modelName: "flux-dev",
                configJson: {
                  defaultForTasks: ["image_generate", "image_edit"],
                },
              },
            });
            await prisma.modelProvider.update({
              where: { key: "video" },
              data: {
                label: "Video Default",
                providerName: "proxy-video",
                modelName: "kling-v2",
                configJson: {
                  defaultForTasks: ["video_generate"],
                },
              },
            });
            const adminSession = await insertSessionForUser(prisma, admin.id);
            const { GET } = await loadRouteModule<{
              GET: () => Promise<Response>;
            }>("src/app/api/admin/providers/route.ts", {
              sessionToken: adminSession.token,
            });

            const response = await GET();

            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual({
              providers: expect.arrayContaining([
                expect.objectContaining({
                  key: "script",
                  modelName: "gpt-4.1-mini",
                }),
                expect.objectContaining({
                  key: "storyboard",
                  modelName: "gpt-4.1-mini",
                }),
                expect.objectContaining({
                  key: "image",
                  modelName: "flux-dev",
                }),
                expect.objectContaining({
                  key: "video",
                  modelName: "kling-v2",
                }),
              ]),
              defaultModels: {
                script_question_generate: expect.objectContaining({
                  providerKey: "script",
                  model: "gpt-4.1-mini",
                  label: "Script Default",
                }),
                script_finalize: expect.objectContaining({
                  providerKey: "script",
                  model: "gpt-4.1-mini",
                }),
                storyboard_split: expect.objectContaining({
                  providerKey: "storyboard",
                  model: "gpt-4.1-mini",
                }),
                image_generate: expect.objectContaining({
                  providerKey: "image",
                  model: "flux-dev",
                }),
                image_edit: expect.objectContaining({
                  providerKey: "image",
                  model: "flux-dev",
                }),
                video_generate: expect.objectContaining({
                  providerKey: "video",
                  model: "kling-v2",
                }),
              },
            });
          },
          {
            DEFAULT_ADMIN_PASSWORD: "AdminPass123!",
            DEFAULT_ADMIN_USERNAME: "admin-providers-tests",
          },
        );
      },
      {
        seed: true,
        seedEnv: {
          DEFAULT_ADMIN_PASSWORD: "AdminPass123!",
          DEFAULT_ADMIN_USERNAME: "admin-providers-tests",
        },
      },
    );
  });
});
