import {
  AssetCategory,
  AssetOrigin,
  Prisma,
  TaskType,
  UserRole,
  UserStatus,
  type PrismaClient,
} from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTestDatabase } from "../db/test-database";
import {
  hashPasswordForTest,
  insertSessionForUser,
  jsonRequest,
  loadRouteModule,
  withApiTestEnv,
} from "./test-api";

const { enqueueTaskMock } = vi.hoisted(() => ({
  enqueueTaskMock: vi.fn(),
}));

vi.mock("@/lib/queues/enqueue", () => ({
  enqueueTask: enqueueTaskMock,
}));

afterEach(() => {
  enqueueTaskMock.mockReset();
  vi.doUnmock("next/headers");
  vi.resetModules();
});

async function createActiveUser(prisma: PrismaClient, username: string) {
  const passwordHash = await hashPasswordForTest("Storyboard123!");

  return prisma.user.create({
    data: {
      username,
      passwordHash,
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      forcePasswordChange: false,
    },
  });
}

async function createScriptAsset(input: {
  prisma: PrismaClient;
  projectId: string;
  originalName: string;
  category: AssetCategory;
  metadata: Prisma.InputJsonObject;
}) {
  return input.prisma.asset.create({
    data: {
      projectId: input.projectId,
      kind:
        input.category === AssetCategory.SCRIPT_SOURCE
          ? "script_source"
          : "script",
      category: input.category,
      origin:
        input.category === AssetCategory.SCRIPT_SOURCE
          ? AssetOrigin.UPLOAD
          : AssetOrigin.SYSTEM,
      storagePath: `assets/${input.projectId}/${input.originalName}`,
      originalName: input.originalName,
      mimeType: "text/plain",
      sizeBytes: 128,
      metadata: input.metadata,
    },
  });
}

describe("storyboards api", () => {
  it("returns the current default script asset and selectable storyboard script assets", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "storyboard-reader");
        const session = await insertSessionForUser(prisma, user.id);
        const project = await prisma.project.create({
          data: {
            ownerId: user.id,
            title: "Storyboard Project",
            idea: "A courier races the sunrise.",
          },
        });
        const finalScriptVersion = await prisma.scriptVersion.create({
          data: {
            projectId: project.id,
            creatorId: user.id,
            versionNumber: 2,
            body: "LEGACY GENERATED SCRIPT BODY",
            scriptJson: {
              body: "LEGACY GENERATED SCRIPT BODY",
            },
          },
        });
        const uploadedAsset = await createScriptAsset({
          prisma,
          projectId: project.id,
          originalName: "uploaded-script.txt",
          category: AssetCategory.SCRIPT_SOURCE,
          metadata: {
            parseStatus: "ready",
            extractedText: "UPLOADED SCRIPT BODY",
          },
        });
        const generatedAsset = await createScriptAsset({
          prisma,
          projectId: project.id,
          originalName: "generated-script.txt",
          category: AssetCategory.SCRIPT_GENERATED,
          metadata: {
            parseStatus: "ready",
            scriptVersionId: finalScriptVersion.id,
            extractedText: "GENERATED ASSET SCRIPT BODY",
          },
        });
        await createScriptAsset({
          prisma,
          projectId: project.id,
          originalName: "pending-script.txt",
          category: AssetCategory.SCRIPT_SOURCE,
          metadata: {
            parseStatus: "pending",
          },
        });
        await createScriptAsset({
          prisma,
          projectId: project.id,
          originalName: "failed-script.txt",
          category: AssetCategory.SCRIPT_SOURCE,
          metadata: {
            parseStatus: "failed",
            parseError: "decode failed",
          },
        });
        await prisma.projectWorkflowBinding.create({
          data: {
            projectId: project.id,
            storyboardScriptAssetId: uploadedAsset.id,
          },
        });

        const storyboardRoute = await loadRouteModule<{
          GET: (
            request: Request,
            context?: { params?: never },
          ) => Promise<Response>;
        }>("src/app/api/storyboards/route.ts", {
          sessionToken: session.token,
        });
        const projectRoute = await loadRouteModule<{
          GET: (
            request: Request,
            context: { params: Promise<{ projectId: string }> | { projectId: string } },
          ) => Promise<Response>;
        }>("src/app/api/projects/[projectId]/route.ts", {
          sessionToken: session.token,
        });

        const storyboardResponse = await storyboardRoute.GET(
          new Request(`http://localhost/api/storyboards?projectId=${project.id}`),
        );
        const storyboardPayload = (await storyboardResponse.json()) as {
          project: {
            id: string;
            title: string;
            idea?: string | null;
          };
          binding: {
            storyboardScriptAssetId: string | null;
          };
          defaultScriptAsset: {
            id: string;
            originalName: string;
            extractedText: string;
          } | null;
          scriptAssets: Array<{
            id: string;
            originalName: string;
            extractedText: string;
            scriptVersionId: string | null;
          }>;
        };

        expect(storyboardResponse.status).toBe(200);
        expect(storyboardPayload.project).toEqual(
          expect.objectContaining({
            id: project.id,
            title: "Storyboard Project",
            idea: "A courier races the sunrise.",
          }),
        );
        expect(storyboardPayload.binding.storyboardScriptAssetId).toBe(uploadedAsset.id);
        expect(storyboardPayload.defaultScriptAsset).toEqual(
          expect.objectContaining({
            id: uploadedAsset.id,
            originalName: "uploaded-script.txt",
            extractedText: "UPLOADED SCRIPT BODY",
          }),
        );
        expect(storyboardPayload.scriptAssets).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: uploadedAsset.id,
              originalName: "uploaded-script.txt",
              extractedText: "UPLOADED SCRIPT BODY",
              scriptVersionId: null,
            }),
            expect.objectContaining({
              id: generatedAsset.id,
              originalName: "generated-script.txt",
              extractedText: "GENERATED ASSET SCRIPT BODY",
              scriptVersionId: finalScriptVersion.id,
            }),
          ]),
        );
        expect(storyboardPayload.scriptAssets).toHaveLength(2);

        const projectResponse = await projectRoute.GET(
          new Request(`http://localhost/api/projects/${project.id}`),
          { params: { projectId: project.id } },
        );

        expect(projectResponse.status).toBe(200);
        await expect(projectResponse.json()).resolves.not.toHaveProperty(
          "scriptAssets",
        );
      });
    });
  });

  it("accepts scriptAssetId and reuses the same storyboard task for duplicate requests", async () => {
    enqueueTaskMock.mockResolvedValue({
      jobId: "job-storyboard-1",
      queueName: "storyboard-queue",
    });

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "storyboard-request-owner");
        const session = await insertSessionForUser(prisma, user.id);
        const project = await prisma.project.create({
          data: {
            ownerId: user.id,
            title: "Storyboard Request Project",
          },
        });
        const scriptVersion = await prisma.scriptVersion.create({
          data: {
            projectId: project.id,
            creatorId: user.id,
            versionNumber: 1,
            body: "LEGACY SCRIPT VERSION BODY",
            scriptJson: {
              body: "LEGACY SCRIPT VERSION BODY",
            },
          },
        });
        const scriptAsset = await createScriptAsset({
          prisma,
          projectId: project.id,
          originalName: "generated-script.txt",
          category: AssetCategory.SCRIPT_GENERATED,
          metadata: {
            parseStatus: "ready",
            scriptVersionId: scriptVersion.id,
            extractedText: "GENERATED ASSET SCRIPT BODY",
          },
        });
        const { POST } = await loadRouteModule<{
          POST: (request: Request) => Promise<Response>;
        }>("src/app/api/storyboards/route.ts", {
          sessionToken: session.token,
        });

        const firstResponse = await POST(
          jsonRequest(
            "http://localhost/api/storyboards",
            {
              projectId: project.id,
              scriptAssetId: scriptAsset.id,
            },
            { method: "POST" },
          ),
        );
        const firstPayload = (await firstResponse.json()) as { taskId: string };
        const secondResponse = await POST(
          jsonRequest(
            "http://localhost/api/storyboards",
            {
              projectId: project.id,
              scriptAssetId: scriptAsset.id,
            },
            { method: "POST" },
          ),
        );
        const secondPayload = (await secondResponse.json()) as { taskId: string };

        expect(firstResponse.status).toBe(202);
        expect(secondResponse.status).toBe(202);
        expect(firstPayload.taskId).toBe(secondPayload.taskId);
        expect(enqueueTaskMock).toHaveBeenCalledTimes(1);
        expect(enqueueTaskMock).toHaveBeenCalledWith(
          firstPayload.taskId,
          TaskType.STORYBOARD,
          expect.objectContaining({
            projectId: project.id,
            scriptAssetId: scriptAsset.id,
            scriptVersionId: scriptVersion.id,
            userId: user.id,
          }),
        );

        await expect(
          prisma.task.findMany({
            where: {
              projectId: project.id,
              createdById: user.id,
              type: TaskType.STORYBOARD,
            },
          }),
        ).resolves.toEqual([
          expect.objectContaining({
            inputJson: expect.objectContaining({
              projectId: project.id,
              scriptAssetId: scriptAsset.id,
              scriptVersionId: scriptVersion.id,
              userId: user.id,
            }),
          }),
        ]);
      });
    });
  });

  it.each(["pending", "failed"] as const)(
    "rejects %s script assets as storyboard input with 409",
    async (parseStatus) => {
      await withTestDatabase(async ({ databaseUrl, prisma }) => {
        await withApiTestEnv(databaseUrl, async () => {
          const user = await createActiveUser(
            prisma,
            `storyboard-request-${parseStatus}`,
          );
          const session = await insertSessionForUser(prisma, user.id);
          const project = await prisma.project.create({
            data: {
              ownerId: user.id,
              title: "Storyboard Invalid Script Asset",
            },
          });
          const scriptAsset = await createScriptAsset({
            prisma,
            projectId: project.id,
            originalName: `${parseStatus}.txt`,
            category: AssetCategory.SCRIPT_SOURCE,
            metadata: {
              parseStatus,
              ...(parseStatus === "failed"
                ? { parseError: "parser exploded" }
                : {}),
            },
          });
          const { POST } = await loadRouteModule<{
            POST: (request: Request) => Promise<Response>;
          }>("src/app/api/storyboards/route.ts", {
            sessionToken: session.token,
          });

          const response = await POST(
            jsonRequest(
              "http://localhost/api/storyboards",
              {
                projectId: project.id,
                scriptAssetId: scriptAsset.id,
              },
              { method: "POST" },
            ),
          );

          expect(response.status).toBe(409);
          await expect(response.json()).resolves.toEqual(
            expect.objectContaining({
              error: expect.any(String),
            }),
          );
          await expect(
            prisma.task.count({
              where: {
                projectId: project.id,
                type: TaskType.STORYBOARD,
              },
            }),
          ).resolves.toBe(0);
        });
      });
    },
  );

  it("resolves legacy scriptVersionId requests through the compatibility asset layer", async () => {
    enqueueTaskMock.mockResolvedValue({
      jobId: "job-storyboard-compat",
      queueName: "storyboard-queue",
    });

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "storyboard-request-legacy");
        const session = await insertSessionForUser(prisma, user.id);
        const project = await prisma.project.create({
          data: {
            ownerId: user.id,
            title: "Storyboard Legacy Compatibility",
          },
        });
        const scriptVersion = await prisma.scriptVersion.create({
          data: {
            projectId: project.id,
            creatorId: user.id,
            versionNumber: 1,
            body: "LEGACY SCRIPT VERSION BODY",
            scriptJson: {
              body: "LEGACY SCRIPT VERSION BODY",
            },
          },
        });
        const generatedAsset = await createScriptAsset({
          prisma,
          projectId: project.id,
          originalName: "generated-script.txt",
          category: AssetCategory.SCRIPT_GENERATED,
          metadata: {
            parseStatus: "ready",
            scriptVersionId: scriptVersion.id,
            extractedText: "GENERATED ASSET SCRIPT BODY",
          },
        });
        const { POST } = await loadRouteModule<{
          POST: (request: Request) => Promise<Response>;
        }>("src/app/api/storyboards/route.ts", {
          sessionToken: session.token,
        });

        const response = await POST(
          jsonRequest(
            "http://localhost/api/storyboards",
            {
              projectId: project.id,
              scriptVersionId: scriptVersion.id,
            },
            { method: "POST" },
          ),
        );
        const payload = (await response.json()) as { taskId: string };
        const task = await prisma.task.findUniqueOrThrow({
          where: {
            id: payload.taskId,
          },
        });

        expect(response.status).toBe(202);
        expect(task.inputJson).toEqual(
          expect.objectContaining({
            projectId: project.id,
            scriptAssetId: generatedAsset.id,
            scriptVersionId: scriptVersion.id,
            userId: user.id,
          }),
        );
        expect(enqueueTaskMock).toHaveBeenCalledWith(
          payload.taskId,
          TaskType.STORYBOARD,
          expect.objectContaining({
            scriptAssetId: generatedAsset.id,
            scriptVersionId: scriptVersion.id,
          }),
        );
      });
    });
  });
});
