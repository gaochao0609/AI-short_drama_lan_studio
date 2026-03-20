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
            const createPayload = (await createResponse.json()) as { provider: Record<string, unknown> };
            expect(createPayload).toEqual({
              provider: expect.objectContaining({
                key: "script-premium",
                providerName: "openai-proxy",
                modelName: "gpt-4.1",
                timeoutMs: 45000,
                maxRetries: 3,
                enabled: true,
                hasApiKey: true,
                configJson: {
                  defaultForTasks: ["script_question_generate", "script_finalize"],
                },
              }),
            });
            expect(createPayload.provider).not.toHaveProperty("apiKey");

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
            const updatePayload = (await updateResponse.json()) as { provider: Record<string, unknown> };
            expect(updatePayload).toEqual({
              provider: expect.objectContaining({
                key: "script-premium",
                label: "Script Premium Updated",
                modelName: "gpt-4.1-mini",
                timeoutMs: 60000,
                enabled: false,
                hasApiKey: true,
                configJson: {
                  defaultForTasks: ["script_finalize"],
                },
              }),
            });
            expect(updatePayload.provider).not.toHaveProperty("apiKey");

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

  it("does not expose stored api keys and supports keep, replace, and clear semantics", async () => {
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
                apiKey: "initial-secret",
              },
            });
            const adminSession = await insertSessionForUser(prisma, admin.id);
            const { GET, PATCH } = await loadRouteModule<{
              GET: () => Promise<Response>;
              PATCH: (request: Request) => Promise<Response>;
            }>("src/app/api/admin/providers/route.ts", {
              sessionToken: adminSession.token,
            });

            const getResponse = await GET();
            expect(getResponse.status).toBe(200);
            const getPayload = (await getResponse.json()) as {
              providers: Array<Record<string, unknown>>;
            };
            const scriptProvider = getPayload.providers.find((provider) => provider.key === "script");
            expect(scriptProvider).toEqual(
              expect.objectContaining({
                key: "script",
                hasApiKey: true,
              }),
            );
            expect(scriptProvider).not.toHaveProperty("apiKey");

            const keepResponse = await PATCH(
              jsonRequest(
                "http://localhost/api/admin/providers",
                {
                  key: "script",
                  label: "Script Keep Secret",
                },
                { method: "PATCH" },
              ),
            );

            expect(keepResponse.status).toBe(200);
            await expect(
              prisma.modelProvider.findUniqueOrThrow({
                where: { key: "script" },
              }),
            ).resolves.toEqual(
              expect.objectContaining({
                key: "script",
                label: "Script Keep Secret",
                apiKey: "initial-secret",
              }),
            );

            const replaceResponse = await PATCH(
              jsonRequest(
                "http://localhost/api/admin/providers",
                {
                  key: "script",
                  apiKey: "replacement-secret",
                },
                { method: "PATCH" },
              ),
            );

            expect(replaceResponse.status).toBe(200);
            await expect(
              prisma.modelProvider.findUniqueOrThrow({
                where: { key: "script" },
              }),
            ).resolves.toEqual(
              expect.objectContaining({
                key: "script",
                apiKey: "replacement-secret",
              }),
            );

            const clearResponse = await PATCH(
              jsonRequest(
                "http://localhost/api/admin/providers",
                {
                  key: "script",
                  apiKey: null,
                },
                { method: "PATCH" },
              ),
            );

            expect(clearResponse.status).toBe(200);
            await expect(clearResponse.json()).resolves.toEqual({
              provider: expect.objectContaining({
                key: "script",
                hasApiKey: false,
              }),
            });
            await expect(
              prisma.modelProvider.findUniqueOrThrow({
                where: { key: "script" },
              }),
            ).resolves.toEqual(
              expect.objectContaining({
                key: "script",
                apiKey: null,
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

  it("reassigns default task ownership when another provider claims a task type", async () => {
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
                configJson: {},
              },
            });
            const adminSession = await insertSessionForUser(prisma, admin.id);
            const { GET, POST } = await loadRouteModule<{
              GET: () => Promise<Response>;
              POST: (request: Request) => Promise<Response>;
            }>("src/app/api/admin/providers/route.ts", {
              sessionToken: adminSession.token,
            });

            const createResponse = await POST(
              jsonRequest(
                "http://localhost/api/admin/providers",
                {
                  key: "script-qa",
                  label: "Script QA",
                  providerName: "openai-proxy",
                  modelName: "gpt-4.1",
                  baseUrl: "https://proxy.example.com/qa",
                  timeoutMs: 30000,
                  maxRetries: 2,
                  enabled: true,
                  configJson: {
                    defaultForTasks: ["script_question_generate"],
                  },
                },
                { method: "POST" },
              ),
            );

            expect(createResponse.status).toBe(201);
            await expect(
              prisma.modelProvider.findUniqueOrThrow({
                where: { key: "script" },
              }),
            ).resolves.toEqual(
              expect.objectContaining({
                key: "script",
                configJson: {
                  defaultForTasks: ["script_finalize"],
                },
              }),
            );

            const getResponse = await GET();
            expect(getResponse.status).toBe(200);
            await expect(getResponse.json()).resolves.toEqual(
              expect.objectContaining({
                defaultModels: expect.objectContaining({
                  script_question_generate: expect.objectContaining({
                    providerKey: "script-qa",
                    model: "gpt-4.1",
                  }),
                  script_finalize: expect.objectContaining({
                    providerKey: "script",
                    model: "gpt-4.1-mini",
                  }),
                }),
                providers: expect.arrayContaining([
                  expect.objectContaining({
                    key: "script",
                    configJson: {
                      defaultForTasks: ["script_finalize"],
                    },
                  }),
                  expect.objectContaining({
                    key: "script-qa",
                    configJson: {
                      defaultForTasks: ["script_question_generate"],
                    },
                  }),
                ]),
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

  it("treats explicit empty default tasks as no default model", async () => {
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
                configJson: {
                  defaultForTasks: ["script_question_generate", "script_finalize"],
                },
              },
            });
            const adminSession = await insertSessionForUser(prisma, admin.id);
            const { GET, PATCH } = await loadRouteModule<{
              GET: () => Promise<Response>;
              PATCH: (request: Request) => Promise<Response>;
            }>("src/app/api/admin/providers/route.ts", {
              sessionToken: adminSession.token,
            });

            const clearResponse = await PATCH(
              jsonRequest(
                "http://localhost/api/admin/providers",
                {
                  key: "script",
                  configJson: {
                    defaultForTasks: [],
                  },
                },
                { method: "PATCH" },
              ),
            );

            expect(clearResponse.status).toBe(200);
            const getResponse = await GET();
            expect(getResponse.status).toBe(200);
            await expect(getResponse.json()).resolves.toEqual(
              expect.objectContaining({
                defaultModels: expect.objectContaining({
                  script_question_generate: null,
                  script_finalize: null,
                }),
                providers: expect.arrayContaining([
                  expect.objectContaining({
                    key: "script",
                    configJson: {
                      defaultForTasks: [],
                    },
                  }),
                ]),
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
});
