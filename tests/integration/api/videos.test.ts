import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { AssetCategory, AssetOrigin, TaskStatus, TaskType, UserRole, UserStatus, type PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, insertSessionForUser, loadRouteModule, withApiTestEnv } from "./test-api";
import { withTestDatabase } from "../db/test-database";

const SAMPLE_MP4_BYTES = Buffer.from("000000186674797069736F6D0000020069736F6D69736F32", "hex");

async function createActiveUser(prisma: PrismaClient, username: string) {
  return prisma.user.create({
    data: {
      username,
      passwordHash: "hash-for-videos-api-user",
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      forcePasswordChange: false,
    },
  });
}

async function createImageAsset(
  prisma: PrismaClient,
  input: {
    projectId: string;
    storageRoot: string;
    fileName: string;
    createdAt: string;
  },
) {
  const relativePath = path.join("assets", input.projectId, "images", input.fileName);
  const absolutePath = path.join(input.storageRoot, relativePath);
  const bytes = Buffer.from(`image-${input.fileName}`);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);

  return prisma.asset.create({
    data: {
      projectId: input.projectId,
      kind: "image_reference",
      category: AssetCategory.IMAGE_SOURCE,
      origin: AssetOrigin.UPLOAD,
      storagePath: relativePath,
      originalName: input.fileName,
      mimeType: "image/png",
      sizeBytes: bytes.length,
      createdAt: new Date(input.createdAt),
    },
  });
}

async function createVideoAsset(
  prisma: PrismaClient,
  input: {
    projectId: string;
    storageRoot: string;
    fileName: string;
    createdAt: string;
  },
) {
  const relativePath = path.join("assets", input.projectId, "videos", input.fileName);
  const absolutePath = path.join(input.storageRoot, relativePath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, SAMPLE_MP4_BYTES);

  return prisma.asset.create({
    data: {
      projectId: input.projectId,
      kind: "video_generated",
      category: AssetCategory.VIDEO_GENERATED,
      origin: AssetOrigin.SYSTEM,
      storagePath: relativePath,
      originalName: input.fileName,
      mimeType: "video/mp4",
      sizeBytes: SAMPLE_MP4_BYTES.length,
      createdAt: new Date(input.createdAt),
    },
  });
}

afterEach(() => {
  vi.doUnmock("next/headers");
  vi.resetModules();
});

describe("videos workspace api", () => {
  it("returns binding-aware workspace data with default image references and preview urls", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-videos-api-workspace-"));

      try {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const user = await createActiveUser(prisma, "videos-workspace-owner");
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Videos Workspace",
              },
            });
            const referenceA = await createImageAsset(prisma, {
              projectId: project.id,
              storageRoot,
              fileName: "reference-a.png",
              createdAt: "2026-04-07T10:00:00.000Z",
            });
            const referenceB = await createImageAsset(prisma, {
              projectId: project.id,
              storageRoot,
              fileName: "reference-b.png",
              createdAt: "2026-04-07T11:00:00.000Z",
            });
            const videoAsset = await createVideoAsset(prisma, {
              projectId: project.id,
              storageRoot,
              fileName: "preview.mp4",
              createdAt: "2026-04-07T12:00:00.000Z",
            });
            const task = await prisma.task.create({
              data: {
                projectId: project.id,
                createdById: user.id,
                type: TaskType.VIDEO,
                status: TaskStatus.SUCCEEDED,
                inputJson: {
                  projectId: project.id,
                  prompt: "Animate the still.",
                  referenceAssetIds: [referenceB.id, referenceA.id],
                },
                outputJson: {
                  ok: true,
                  outputAssetId: videoAsset.id,
                },
              },
            });

            await prisma.projectWorkflowBinding.create({
              data: {
                projectId: project.id,
                videoReferenceAssetIds: [referenceB.id, referenceA.id],
              },
            });

            const session = await insertSessionForUser(prisma, user.id);
            const route = await loadRouteModule<{
              GET: (request: Request) => Promise<Response>;
            }>("src/app/api/videos/route.ts", {
              sessionToken: session.token,
            });

            const response = await route.GET(
              new Request(`http://localhost/api/videos?projectId=${project.id}`, {
                method: "GET",
              }),
            );

            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual(
              expect.objectContaining({
                project: expect.objectContaining({
                  id: project.id,
                  title: "Videos Workspace",
                }),
                binding: {
                  videoReferenceAssetIds: [referenceB.id, referenceA.id],
                },
                defaultReferenceAssets: [
                  expect.objectContaining({ id: referenceB.id, originalName: "reference-b.png" }),
                  expect.objectContaining({ id: referenceA.id, originalName: "reference-a.png" }),
                ],
                referenceAssets: [
                  expect.objectContaining({ id: referenceB.id, originalName: "reference-b.png" }),
                  expect.objectContaining({ id: referenceA.id, originalName: "reference-a.png" }),
                ],
                videoAssets: [
                  expect.objectContaining({
                    id: videoAsset.id,
                    previewDataUrl: null,
                    previewUrl: `/api/videos?projectId=${project.id}&assetId=${videoAsset.id}`,
                  }),
                ],
                tasks: [
                  expect.objectContaining({
                    id: task.id,
                    status: TaskStatus.SUCCEEDED,
                  }),
                ],
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

  it("force-includes bound default video reference assets outside the candidate query window", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-videos-api-bound-window-"));

      try {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const user = await createActiveUser(prisma, "videos-bound-window-owner");
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Videos Bound Window",
              },
            });

            const boundAsset = await createImageAsset(prisma, {
              projectId: project.id,
              storageRoot,
              fileName: "bound-old.png",
              createdAt: "2026-01-01T00:00:00.000Z",
            });

            for (let index = 0; index < 50; index += 1) {
              await createImageAsset(prisma, {
                projectId: project.id,
                storageRoot,
                fileName: `candidate-${index}.png`,
                createdAt: `2026-04-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
              });
            }

            await prisma.projectWorkflowBinding.create({
              data: {
                projectId: project.id,
                videoReferenceAssetIds: [boundAsset.id],
              },
            });

            const session = await insertSessionForUser(prisma, user.id);
            const route = await loadRouteModule<{
              GET: (request: Request) => Promise<Response>;
            }>("src/app/api/videos/route.ts", {
              sessionToken: session.token,
            });

            const response = await route.GET(
              new Request(`http://localhost/api/videos?projectId=${project.id}`, {
                method: "GET",
              }),
            );

            expect(response.status).toBe(200);
            const payload = (await response.json()) as {
              binding: { videoReferenceAssetIds: string[] };
              defaultReferenceAssets: Array<{ id: string; originalName: string | null }>;
              referenceAssets: Array<{ id: string; originalName: string | null }>;
            };

            expect(payload.binding.videoReferenceAssetIds).toEqual([boundAsset.id]);
            expect(payload.defaultReferenceAssets).toEqual([
              expect.objectContaining({
                id: boundAsset.id,
                originalName: "bound-old.png",
              }),
            ]);
            expect(payload.referenceAssets).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  id: boundAsset.id,
                  originalName: "bound-old.png",
                }),
              ]),
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

  it("keeps preview streaming range support for generated video assets", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-videos-api-preview-"));

      try {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const user = await createActiveUser(prisma, "videos-preview-owner");
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Videos Preview",
              },
            });
            const videoAsset = await createVideoAsset(prisma, {
              projectId: project.id,
              storageRoot,
              fileName: "preview.mp4",
              createdAt: "2026-04-07T12:00:00.000Z",
            });
            const session = await insertSessionForUser(prisma, user.id);
            const route = await loadRouteModule<{
              GET: (request: Request) => Promise<Response>;
            }>("src/app/api/videos/route.ts", {
              sessionToken: session.token,
            });

            const response = await route.GET(
              new Request(`http://localhost/api/videos?projectId=${project.id}&assetId=${videoAsset.id}`, {
                method: "GET",
                headers: {
                  range: "bytes=0-3",
                },
              }),
            );

            expect(response.status).toBe(206);
            expect(response.headers.get("content-type")).toBe("video/mp4");
            expect(response.headers.get("accept-ranges")).toBe("bytes");
            expect(response.headers.get("content-range")).toBe(
              `bytes 0-3/${SAMPLE_MP4_BYTES.length}`,
            );
            await expect(response.arrayBuffer()).resolves.toEqual(
              SAMPLE_MP4_BYTES.buffer.slice(
                SAMPLE_MP4_BYTES.byteOffset,
                SAMPLE_MP4_BYTES.byteOffset + 4,
              ),
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

  it("accepts ordered one-off reference asset overrides for video generation", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-videos-api-post-"));

      try {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const user = await createActiveUser(prisma, "videos-post-owner");
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Videos Post",
              },
            });
            const referenceA = await createImageAsset(prisma, {
              projectId: project.id,
              storageRoot,
              fileName: "reference-a.png",
              createdAt: "2026-04-07T10:00:00.000Z",
            });
            const referenceB = await createImageAsset(prisma, {
              projectId: project.id,
              storageRoot,
              fileName: "reference-b.png",
              createdAt: "2026-04-07T11:00:00.000Z",
            });
            const session = await insertSessionForUser(prisma, user.id);
            const route = await loadRouteModule<{
              POST: (request: Request) => Promise<Response>;
            }>("src/app/api/videos/route.ts", {
              sessionToken: session.token,
            });

            const response = await route.POST(
              jsonRequest(
                "http://localhost/api/videos",
                {
                  projectId: project.id,
                  prompt: "Animate the frame with a slow dolly-in.",
                  referenceAssetIds: [referenceB.id, referenceA.id],
                },
                { method: "POST" },
              ),
            );

            expect(response.status).toBe(202);
            const payload = (await response.json()) as { taskId: string };
            const task = await prisma.task.findUniqueOrThrow({
              where: {
                id: payload.taskId,
              },
            });

            expect(task.inputJson).toEqual(
              expect.objectContaining({
                projectId: project.id,
                userId: user.id,
                prompt: "Animate the frame with a slow dolly-in.",
                referenceAssetIds: [referenceB.id, referenceA.id],
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

  it("rejects video generation requests without any reference assets", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "videos-post-empty-owner");
        const project = await prisma.project.create({
          data: {
            ownerId: user.id,
            title: "Videos Empty References",
          },
        });
        const session = await insertSessionForUser(prisma, user.id);
        const route = await loadRouteModule<{
          POST: (request: Request) => Promise<Response>;
        }>("src/app/api/videos/route.ts", {
          sessionToken: session.token,
        });

        const response = await route.POST(
          jsonRequest(
            "http://localhost/api/videos",
            {
              projectId: project.id,
              prompt: "Animate the frame.",
              referenceAssetIds: [],
            },
            { method: "POST" },
          ),
        );

        expect(response.status).toBe(400);
      });
    });
  });
});
