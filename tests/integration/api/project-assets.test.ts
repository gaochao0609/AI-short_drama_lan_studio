import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import {
  AssetCategory,
  AssetOrigin,
  TaskType,
  UserRole,
  UserStatus,
  type PrismaClient,
} from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, insertSessionForUser, loadRouteModule, withApiTestEnv } from "./test-api";
import { withTestDatabase } from "../db/test-database";

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
  return prisma.user.create({
    data: {
      username,
      passwordHash: "hash-for-project-assets-user",
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      forcePasswordChange: false,
    },
  });
}

describe("project assets api", () => {
  it("routes ASSET_SCRIPT_PARSE tasks to an isolated queue", async () => {
    await withTestDatabase(async ({ databaseUrl }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const { getQueueForTaskType, closeQueues } = await import("@/lib/queues");

        try {
          expect(getQueueForTaskType(TaskType.SCRIPT_FINALIZE).name).toBe("script-queue");
          expect(getQueueForTaskType(TaskType.ASSET_SCRIPT_PARSE).name).toBe(
            "asset-script-parse-queue",
          );
        } finally {
          await closeQueues();
        }
      });
    });
  });

  it("lists grouped assets with workflow bindings for an owned project", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-project-assets-list-"));

      try {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const user = await createActiveUser(prisma, "project-assets-list-owner");
            const session = await insertSessionForUser(prisma, user.id);
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Project Assets List",
              },
            });

            const scriptAsset = await prisma.asset.create({
              data: {
                projectId: project.id,
                kind: "script",
                category: AssetCategory.SCRIPT_SOURCE,
                origin: AssetOrigin.UPLOAD,
                storagePath: "uploads/script/scene.txt",
                originalName: "scene.txt",
                mimeType: "text/plain",
                sizeBytes: 32,
                metadata: {
                  parseStatus: "pending",
                },
                createdAt: new Date("2026-04-07T10:00:00.000Z"),
              },
            });
            const imageSourceA = await prisma.asset.create({
              data: {
                projectId: project.id,
                kind: "image_reference",
                category: AssetCategory.IMAGE_SOURCE,
                origin: AssetOrigin.UPLOAD,
                storagePath: "assets/source/a.png",
                originalName: "a.png",
                mimeType: "image/png",
                sizeBytes: 12,
                createdAt: new Date("2026-04-07T10:01:00.000Z"),
              },
            });
            const imageSourceB = await prisma.asset.create({
              data: {
                projectId: project.id,
                kind: "image_reference",
                category: AssetCategory.IMAGE_SOURCE,
                origin: AssetOrigin.UPLOAD,
                storagePath: "assets/source/b.png",
                originalName: "b.png",
                mimeType: "image/png",
                sizeBytes: 12,
                createdAt: new Date("2026-04-07T10:02:00.000Z"),
              },
            });
            const imageGenerated = await prisma.asset.create({
              data: {
                projectId: project.id,
                kind: "image_generated",
                category: AssetCategory.IMAGE_GENERATED,
                origin: AssetOrigin.SYSTEM,
                storagePath: "generated/image.png",
                originalName: "image.png",
                mimeType: "image/png",
                sizeBytes: 24,
                createdAt: new Date("2026-04-07T10:03:00.000Z"),
              },
            });

            await prisma.projectWorkflowBinding.create({
              data: {
                projectId: project.id,
                storyboardScriptAssetId: scriptAsset.id,
                imageReferenceAssetIds: [imageSourceB.id, imageSourceA.id],
                videoReferenceAssetIds: [imageSourceA.id],
              },
            });

            const route = await loadRouteModule<{
              GET: (
                request: Request,
                context: { params: Promise<{ projectId: string }> | { projectId: string } },
              ) => Promise<Response>;
            }>("src/app/api/projects/[projectId]/assets/route.ts", {
              sessionToken: session.token,
            });

            const listResponse = await route.GET(
              new Request(`http://localhost/api/projects/${project.id}/assets`),
              { params: { projectId: project.id } },
            );

            expect(listResponse.status).toBe(200);
            await expect(listResponse.json()).resolves.toEqual(
              expect.objectContaining({
                project: expect.objectContaining({
                  id: project.id,
                }),
                bindings: {
                  storyboardScriptAssetId: scriptAsset.id,
                  imageReferenceAssetIds: [imageSourceB.id, imageSourceA.id],
                  videoReferenceAssetIds: [imageSourceA.id],
                },
                assets: {
                  script_source: [
                    expect.objectContaining({
                      id: scriptAsset.id,
                      originalName: "scene.txt",
                      category: "script_source",
                      origin: "upload",
                      mimeType: "text/plain",
                      parseStatus: "pending",
                      parseError: null,
                      downloadUrl: `/api/assets/${scriptAsset.id}/download`,
                    }),
                  ],
                  script_generated: [],
                  image_source: [
                    expect.objectContaining({ id: imageSourceB.id, originalName: "b.png" }),
                    expect.objectContaining({ id: imageSourceA.id, originalName: "a.png" }),
                  ],
                  image_generated: [
                    expect.objectContaining({
                      id: imageGenerated.id,
                      originalName: "image.png",
                      category: "image_generated",
                      origin: "system",
                    }),
                  ],
                  video_generated: [],
                },
              }),
            );
          },
          {
            STORAGE_ROOT: storageRoot,
          },
        );
      } finally {
        await rm(storageRoot, { recursive: true, force: true });
      }
    });
  });

  it("uploads script and image files as project assets", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-project-assets-upload-"));

      try {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            enqueueTaskMock.mockResolvedValue({
              jobId: "job-asset-script-parse",
              queueName: "script-queue",
            });

            const user = await createActiveUser(prisma, "project-assets-upload-owner");
            const session = await insertSessionForUser(prisma, user.id);
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Project Assets Upload",
              },
            });

            const route = await loadRouteModule<{
              POST: (
                request: Request,
                context: { params: Promise<{ projectId: string }> | { projectId: string } },
              ) => Promise<Response>;
            }>("src/app/api/projects/[projectId]/assets/route.ts", {
              sessionToken: session.token,
            });

            const scriptBytes = Buffer.from("# INT. ROOFTOP - NIGHT\nA courier arrives.");
            const scriptFile = new File([scriptBytes], "scene.md", { type: "text/markdown" });
            const scriptForm = new FormData();
            scriptForm.set("file", scriptFile);

            const uploadScriptResponse = await route.POST(
              {
                url: `http://localhost/api/projects/${project.id}/assets`,
                headers: new Headers({
                  "content-type": "multipart/form-data; boundary=----vitest",
                  "content-length": String(scriptBytes.length),
                }),
                formData: async () => scriptForm,
              } as unknown as Request,
              { params: { projectId: project.id } },
            );

            expect(uploadScriptResponse.status).toBe(202);

            const uploadedScriptAsset = await prisma.asset.findFirstOrThrow({
              where: {
                projectId: project.id,
                category: AssetCategory.SCRIPT_SOURCE,
                origin: AssetOrigin.UPLOAD,
              },
              orderBy: {
                createdAt: "desc",
              },
            });
            expect(uploadedScriptAsset.mimeType).toBe("text/markdown");
            expect(uploadedScriptAsset.metadata).toEqual(
              expect.objectContaining({
                parseStatus: "pending",
              }),
            );

            expect(enqueueTaskMock).toHaveBeenCalledWith(
              expect.any(String),
              TaskType.ASSET_SCRIPT_PARSE,
              expect.objectContaining({
                assetId: uploadedScriptAsset.id,
                projectId: project.id,
                userId: user.id,
              }),
            );

            const imageBytes = Buffer.from("fake-png-bytes");
            const imageFile = new File([imageBytes], "reference.png", { type: "image/png" });
            const imageForm = new FormData();
            imageForm.set("file", imageFile);

            const uploadImageResponse = await route.POST(
              {
                url: `http://localhost/api/projects/${project.id}/assets`,
                headers: new Headers({
                  "content-type": "multipart/form-data; boundary=----vitest",
                  "content-length": String(imageBytes.length),
                }),
                formData: async () => imageForm,
              } as unknown as Request,
              { params: { projectId: project.id } },
            );

            expect(uploadImageResponse.status).toBe(202);

            const uploadedImageAsset = await prisma.asset.findFirstOrThrow({
              where: {
                projectId: project.id,
                category: AssetCategory.IMAGE_SOURCE,
                origin: AssetOrigin.UPLOAD,
              },
              orderBy: {
                createdAt: "desc",
              },
            });
            expect(uploadedImageAsset.mimeType).toBe("image/png");
          },
          {
            STORAGE_ROOT: storageRoot,
          },
        );
      } finally {
        await rm(storageRoot, { recursive: true, force: true });
      }
    });
  });

  it("marks uploaded script assets as failed when parse task enqueue fails", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(
        path.join(os.tmpdir(), "lan-studio-project-assets-upload-enqueue-fail-"),
      );

      try {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            enqueueTaskMock.mockRejectedValueOnce(new Error("script parse queue unavailable"));

            const user = await createActiveUser(prisma, "project-assets-upload-enqueue-fail-owner");
            const session = await insertSessionForUser(prisma, user.id);
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Project Assets Upload Enqueue Failure",
              },
            });

            const assetsRoute = await loadRouteModule<{
              POST: (
                request: Request,
                context: { params: Promise<{ projectId: string }> | { projectId: string } },
              ) => Promise<Response>;
            }>("src/app/api/projects/[projectId]/assets/route.ts", {
              sessionToken: session.token,
            });

            const scriptBytes = Buffer.from("INT. CAFE - DAWN");
            const scriptFile = new File([scriptBytes], "scene.txt", { type: "text/plain" });
            const scriptForm = new FormData();
            scriptForm.set("file", scriptFile);

            const uploadResponse = await assetsRoute.POST(
              {
                url: `http://localhost/api/projects/${project.id}/assets`,
                headers: new Headers({
                  "content-type": "multipart/form-data; boundary=----vitest",
                  "content-length": String(scriptBytes.length),
                }),
                formData: async () => scriptForm,
              } as unknown as Request,
              { params: { projectId: project.id } },
            );

            expect(uploadResponse.status).toBe(500);

            const uploadedScriptAsset = await prisma.asset.findFirstOrThrow({
              where: {
                projectId: project.id,
                category: AssetCategory.SCRIPT_SOURCE,
              },
              orderBy: {
                createdAt: "desc",
              },
            });
            expect(uploadedScriptAsset.metadata).toEqual(
              expect.objectContaining({
                parseStatus: "failed",
                parseError: expect.stringContaining("script parse queue unavailable"),
              }),
            );

            enqueueTaskMock.mockResolvedValueOnce({
              jobId: "job-recover-after-upload-enqueue-fail",
              queueName: "asset-script-parse-queue",
            });
            const retryRoute = await loadRouteModule<{
              POST: (
                request: Request,
                context: {
                  params:
                    | Promise<{ projectId: string; assetId: string }>
                    | { projectId: string; assetId: string };
                },
              ) => Promise<Response>;
            }>("src/app/api/projects/[projectId]/assets/[assetId]/retry/route.ts", {
              sessionToken: session.token,
            });

            const retryResponse = await retryRoute.POST(
              new Request(
                `http://localhost/api/projects/${project.id}/assets/${uploadedScriptAsset.id}/retry`,
                {
                  method: "POST",
                },
              ),
              { params: { projectId: project.id, assetId: uploadedScriptAsset.id } },
            );

            expect(retryResponse.status).toBe(202);
          },
          {
            STORAGE_ROOT: storageRoot,
          },
        );
      } finally {
        await rm(storageRoot, { recursive: true, force: true });
      }
    });
  });

  it("patches workflow bindings with project ownership checks and ordered de-duplication", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "project-assets-bindings-owner");
        const session = await insertSessionForUser(prisma, user.id);
        const project = await prisma.project.create({
          data: {
            ownerId: user.id,
            title: "Project Assets Bindings",
          },
        });
        const otherProject = await prisma.project.create({
          data: {
            ownerId: user.id,
            title: "Other Assets Project",
          },
        });

        const scriptAsset = await prisma.asset.create({
          data: {
            projectId: project.id,
            kind: "script",
            category: AssetCategory.SCRIPT_SOURCE,
            origin: AssetOrigin.UPLOAD,
            storagePath: "uploads/script/source.txt",
            originalName: "source.txt",
            mimeType: "text/plain",
            sizeBytes: 10,
            metadata: {
              parseStatus: "ready",
              extractedText: "INT. ROOFTOP - DAWN",
            },
          },
        });
        const imageA = await prisma.asset.create({
          data: {
            projectId: project.id,
            kind: "image_reference",
            category: AssetCategory.IMAGE_SOURCE,
            origin: AssetOrigin.UPLOAD,
            storagePath: "uploads/images/a.png",
            originalName: "a.png",
            mimeType: "image/png",
            sizeBytes: 10,
          },
        });
        const imageB = await prisma.asset.create({
          data: {
            projectId: project.id,
            kind: "image_reference",
            category: AssetCategory.IMAGE_SOURCE,
            origin: AssetOrigin.UPLOAD,
            storagePath: "uploads/images/b.png",
            originalName: "b.png",
            mimeType: "image/png",
            sizeBytes: 10,
          },
        });
        const nonImageAsset = await prisma.asset.create({
          data: {
            projectId: project.id,
            kind: "video_generated",
            category: AssetCategory.VIDEO_GENERATED,
            origin: AssetOrigin.SYSTEM,
            storagePath: "generated/video.mp4",
            originalName: "video.mp4",
            mimeType: "video/mp4",
            sizeBytes: 10,
          },
        });
        const otherProjectImage = await prisma.asset.create({
          data: {
            projectId: otherProject.id,
            kind: "image_reference",
            category: AssetCategory.IMAGE_SOURCE,
            origin: AssetOrigin.UPLOAD,
            storagePath: "uploads/images/other.png",
            originalName: "other.png",
            mimeType: "image/png",
            sizeBytes: 10,
          },
        });

        const route = await loadRouteModule<{
          PATCH: (
            request: Request,
            context: { params: Promise<{ projectId: string }> | { projectId: string } },
          ) => Promise<Response>;
        }>("src/app/api/projects/[projectId]/workflow-binding/route.ts", {
          sessionToken: session.token,
        });

        const bindingPatch = await route.PATCH(
          jsonRequest(
            `http://localhost/api/projects/${project.id}/workflow-binding`,
            {
              storyboardScriptAssetId: scriptAsset.id,
              imageReferenceAssetIds: [imageB.id, imageA.id, imageB.id],
              videoReferenceAssetIds: [imageA.id, imageA.id],
            },
            { method: "PATCH" },
          ),
          { params: { projectId: project.id } },
        );

        expect(bindingPatch.status).toBe(200);
        await expect(bindingPatch.json()).resolves.toEqual({
          storyboardScriptAssetId: scriptAsset.id,
          imageReferenceAssetIds: [imageB.id, imageA.id],
          videoReferenceAssetIds: [imageA.id],
        });

        await expect(
          prisma.projectWorkflowBinding.findUniqueOrThrow({
            where: {
              projectId: project.id,
            },
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            storyboardScriptAssetId: scriptAsset.id,
            imageReferenceAssetIds: [imageB.id, imageA.id],
            videoReferenceAssetIds: [imageA.id],
          }),
        );

        const nonImagePatch = await route.PATCH(
          jsonRequest(
            `http://localhost/api/projects/${project.id}/workflow-binding`,
            {
              imageReferenceAssetIds: [nonImageAsset.id],
            },
            { method: "PATCH" },
          ),
          { params: { projectId: project.id } },
        );

        expect(nonImagePatch.status).toBe(409);

        const crossProjectPatch = await route.PATCH(
          jsonRequest(
            `http://localhost/api/projects/${project.id}/workflow-binding`,
            {
              imageReferenceAssetIds: [otherProjectImage.id],
            },
            { method: "PATCH" },
          ),
          { params: { projectId: project.id } },
        );

        expect(crossProjectPatch.status).toBe(404);
      });
    });
  });

  it("retries parsing only for failed script_source assets and reuses the same asset", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-project-assets-retry-"));

      try {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            enqueueTaskMock.mockResolvedValue({
              jobId: "job-retry-asset-script-parse",
              queueName: "script-queue",
            });

            const user = await createActiveUser(prisma, "project-assets-retry-owner");
            const session = await insertSessionForUser(prisma, user.id);
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Project Assets Retry",
              },
            });
            const failedScriptAsset = await prisma.asset.create({
              data: {
                projectId: project.id,
                kind: "script",
                category: AssetCategory.SCRIPT_SOURCE,
                origin: AssetOrigin.UPLOAD,
                storagePath: "uploads/scripts/retry.txt",
                originalName: "retry.txt",
                mimeType: "text/plain",
                sizeBytes: 12,
                metadata: {
                  parseStatus: "failed",
                  parseError: "decoder exploded",
                },
              },
            });

            const route = await loadRouteModule<{
              POST: (
                request: Request,
                context: {
                  params:
                    | Promise<{ projectId: string; assetId: string }>
                    | { projectId: string; assetId: string };
                },
              ) => Promise<Response>;
            }>("src/app/api/projects/[projectId]/assets/[assetId]/retry/route.ts", {
              sessionToken: session.token,
            });

            const retryResponse = await route.POST(
              new Request(`http://localhost/api/projects/${project.id}/assets/${failedScriptAsset.id}/retry`, {
                method: "POST",
              }),
              { params: { projectId: project.id, assetId: failedScriptAsset.id } },
            );

            expect(retryResponse.status).toBe(202);

            const retriedAsset = await prisma.asset.findUniqueOrThrow({
              where: {
                id: failedScriptAsset.id,
              },
            });
            expect(retriedAsset.metadata).toEqual(
              expect.objectContaining({
                parseStatus: "pending",
              }),
            );
            expect((retriedAsset.metadata as { parseError?: string } | null)?.parseError).toBeUndefined();
            expect(
              await prisma.asset.count({
                where: {
                  projectId: project.id,
                  category: AssetCategory.SCRIPT_SOURCE,
                },
              }),
            ).toBe(1);

            expect(enqueueTaskMock).toHaveBeenCalledWith(
              expect.any(String),
              TaskType.ASSET_SCRIPT_PARSE,
              expect.objectContaining({
                assetId: failedScriptAsset.id,
                projectId: project.id,
                userId: user.id,
              }),
            );
          },
          {
            STORAGE_ROOT: storageRoot,
          },
        );
      } finally {
        await rm(storageRoot, { recursive: true, force: true });
      }
    });
  });

  it("keeps script assets recoverable when retry enqueue fails", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(
        path.join(os.tmpdir(), "lan-studio-project-assets-retry-enqueue-fail-"),
      );

      try {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            enqueueTaskMock.mockRejectedValueOnce(new Error("retry enqueue failed"));

            const user = await createActiveUser(prisma, "project-assets-retry-enqueue-fail-owner");
            const session = await insertSessionForUser(prisma, user.id);
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Project Assets Retry Enqueue Failure",
              },
            });
            const failedScriptAsset = await prisma.asset.create({
              data: {
                projectId: project.id,
                kind: "script",
                category: AssetCategory.SCRIPT_SOURCE,
                origin: AssetOrigin.UPLOAD,
                storagePath: "uploads/scripts/retry-enqueue-fail.txt",
                originalName: "retry-enqueue-fail.txt",
                mimeType: "text/plain",
                sizeBytes: 18,
                metadata: {
                  parseStatus: "failed",
                  parseError: "first failure",
                },
              },
            });

            const retryRoute = await loadRouteModule<{
              POST: (
                request: Request,
                context: {
                  params:
                    | Promise<{ projectId: string; assetId: string }>
                    | { projectId: string; assetId: string };
                },
              ) => Promise<Response>;
            }>("src/app/api/projects/[projectId]/assets/[assetId]/retry/route.ts", {
              sessionToken: session.token,
            });

            const retryResponse = await retryRoute.POST(
              new Request(
                `http://localhost/api/projects/${project.id}/assets/${failedScriptAsset.id}/retry`,
                {
                  method: "POST",
                },
              ),
              { params: { projectId: project.id, assetId: failedScriptAsset.id } },
            );

            expect(retryResponse.status).toBe(500);

            const retriedAsset = await prisma.asset.findUniqueOrThrow({
              where: {
                id: failedScriptAsset.id,
              },
            });
            expect(retriedAsset.metadata).toEqual(
              expect.objectContaining({
                parseStatus: "failed",
                parseError: expect.stringContaining("retry enqueue failed"),
              }),
            );
          },
          {
            STORAGE_ROOT: storageRoot,
          },
        );
      } finally {
        await rm(storageRoot, { recursive: true, force: true });
      }
    });
  });

  it("returns conflict when deleting a bound or provenance-referenced asset", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "project-assets-delete-owner");
        const session = await insertSessionForUser(prisma, user.id);
        const project = await prisma.project.create({
          data: {
            ownerId: user.id,
            title: "Project Assets Delete",
          },
        });

        const boundScriptAsset = await prisma.asset.create({
          data: {
            projectId: project.id,
            kind: "script",
            category: AssetCategory.SCRIPT_SOURCE,
            origin: AssetOrigin.UPLOAD,
            storagePath: "uploads/scripts/bound.txt",
            originalName: "bound.txt",
            mimeType: "text/plain",
            sizeBytes: 12,
            metadata: {
              parseStatus: "ready",
              extractedText: "INT. LIBRARY - DUSK",
            },
          },
        });
        const sourceImageAsset = await prisma.asset.create({
          data: {
            projectId: project.id,
            kind: "image_reference",
            category: AssetCategory.IMAGE_SOURCE,
            origin: AssetOrigin.UPLOAD,
            storagePath: "uploads/images/source.png",
            originalName: "source.png",
            mimeType: "image/png",
            sizeBytes: 12,
          },
        });
        const generatedImageAsset = await prisma.asset.create({
          data: {
            projectId: project.id,
            kind: "image_generated",
            category: AssetCategory.IMAGE_GENERATED,
            origin: AssetOrigin.SYSTEM,
            storagePath: "generated/images/result.png",
            originalName: "result.png",
            mimeType: "image/png",
            sizeBytes: 12,
          },
        });

        await prisma.projectWorkflowBinding.create({
          data: {
            projectId: project.id,
            storyboardScriptAssetId: boundScriptAsset.id,
          },
        });
        await prisma.assetSourceLink.create({
          data: {
            assetId: generatedImageAsset.id,
            sourceAssetId: sourceImageAsset.id,
            role: "image_reference",
            orderIndex: 0,
          },
        });

        const route = await loadRouteModule<{
          DELETE: (
            request: Request,
            context: {
              params:
                | Promise<{ projectId: string; assetId: string }>
                | { projectId: string; assetId: string };
            },
          ) => Promise<Response>;
        }>("src/app/api/projects/[projectId]/assets/[assetId]/route.ts", {
          sessionToken: session.token,
        });

        const deleteBoundResponse = await route.DELETE(
          new Request(`http://localhost/api/projects/${project.id}/assets/${boundScriptAsset.id}`, {
            method: "DELETE",
          }),
          { params: { projectId: project.id, assetId: boundScriptAsset.id } },
        );

        expect(deleteBoundResponse.status).toBe(409);

        const deleteReferencedResponse = await route.DELETE(
          new Request(`http://localhost/api/projects/${project.id}/assets/${sourceImageAsset.id}`, {
            method: "DELETE",
          }),
          { params: { projectId: project.id, assetId: sourceImageAsset.id } },
        );

        expect(deleteReferencedResponse.status).toBe(409);
      });
    });
  });
});
