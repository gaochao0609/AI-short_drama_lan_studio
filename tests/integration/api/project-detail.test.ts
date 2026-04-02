import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { TaskStatus, TaskType, UserRole, UserStatus, type PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTestDatabase } from "../db/test-database";
import {
  hashPasswordForTest,
  insertSessionForUser,
  loadRouteModule,
  withApiTestEnv,
} from "./test-api";

const ONE_BY_ONE_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7GZxkAAAAASUVORK5CYII=",
  "base64",
);

const SAMPLE_MP4_BYTES = Buffer.from("000000186674797069736F6D0000020069736F6D69736F32", "hex");

afterEach(() => {
  vi.doUnmock("next/headers");
  vi.resetModules();
});

async function createActiveUser(prisma: PrismaClient, username: string) {
  const passwordHash = await hashPasswordForTest("ProjectDetail123!");

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

async function writeAssetFile(storageRoot: string, relativePath: string, bytes: Uint8Array) {
  const absolutePath = path.join(storageRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
}

describe("project detail api", () => {
  it("returns project detail with versions, assets, and task history", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-project-detail-"));

      try {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const user = await createActiveUser(prisma, "project-detail-owner");
            const session = await insertSessionForUser(prisma, user.id);
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Project Detail",
                idea: "Collect every artifact in one place.",
              },
            });
            const scriptTask = await prisma.task.create({
              data: {
                id: "task-script-detail",
                projectId: project.id,
                createdById: user.id,
                type: TaskType.SCRIPT_FINALIZE,
                status: TaskStatus.SUCCEEDED,
                inputJson: {
                  projectId: project.id,
                },
                outputJson: {
                  scriptVersionId: "script-version-2",
                },
                finishedAt: new Date("2026-03-30T09:00:00.000Z"),
              },
            });
            const storyboardTask = await prisma.task.create({
              data: {
                id: "task-storyboard-detail",
                projectId: project.id,
                createdById: user.id,
                type: TaskType.STORYBOARD,
                status: TaskStatus.SUCCEEDED,
                inputJson: {
                  projectId: project.id,
                },
                outputJson: {
                  storyboardVersionId: "storyboard-version-1",
                },
                finishedAt: new Date("2026-03-30T09:10:00.000Z"),
              },
            });
            const imageTask = await prisma.task.create({
              data: {
                id: "task-image-detail",
                projectId: project.id,
                createdById: user.id,
                type: TaskType.IMAGE,
                status: TaskStatus.SUCCEEDED,
                inputJson: {
                  prompt: "Generate a poster frame",
                },
                outputJson: {
                  outputAssetId: "image-asset-detail",
                },
                finishedAt: new Date("2026-03-30T09:20:00.000Z"),
              },
            });
            const videoTask = await prisma.task.create({
              data: {
                id: "task-video-detail",
                projectId: project.id,
                createdById: user.id,
                type: TaskType.VIDEO,
                status: TaskStatus.SUCCEEDED,
                inputJson: {
                  prompt: "Animate the poster frame",
                },
                outputJson: {
                  outputAssetId: "video-asset-detail",
                },
                finishedAt: new Date("2026-03-30T09:30:00.000Z"),
              },
            });

            await prisma.scriptVersion.createMany({
              data: [
                {
                  id: "script-version-1",
                  projectId: project.id,
                  creatorId: user.id,
                  versionNumber: 1,
                  body: "Version one body",
                  scriptJson: {
                    body: "Version one body",
                  },
                },
                {
                  id: "script-version-2",
                  projectId: project.id,
                  creatorId: user.id,
                  versionNumber: 2,
                  body: "Version two body",
                  scriptJson: {
                    body: "Version two body",
                  },
                },
              ],
            });
            await prisma.storyboardVersion.create({
              data: {
                id: "storyboard-version-1",
                projectId: project.id,
                scriptVersionId: "script-version-2",
                taskId: storyboardTask.id,
                framesJson: [
                  { index: 1, scene: "Scene 1" },
                  { index: 2, scene: "Scene 2" },
                  { index: 3, scene: "Scene 3" },
                ],
              },
            });

            const imageRelativePath = path.join("assets", project.id, "generated", "poster.png");
            const videoRelativePath = path.join("assets", project.id, "generated", "clip.mp4");
            await writeAssetFile(storageRoot, imageRelativePath, ONE_BY_ONE_PNG_BYTES);
            await writeAssetFile(storageRoot, videoRelativePath, SAMPLE_MP4_BYTES);

            await prisma.asset.createMany({
              data: [
                {
                  id: "image-asset-detail",
                  projectId: project.id,
                  taskId: imageTask.id,
                  kind: "image_generated",
                  storagePath: imageRelativePath,
                  originalName: "poster.png",
                  mimeType: "image/png",
                  sizeBytes: ONE_BY_ONE_PNG_BYTES.length,
                },
                {
                  id: "video-asset-detail",
                  projectId: project.id,
                  taskId: videoTask.id,
                  kind: "video_generated",
                  storagePath: videoRelativePath,
                  originalName: "clip.mp4",
                  mimeType: "video/mp4",
                  sizeBytes: SAMPLE_MP4_BYTES.length,
                },
              ],
            });

            const route = await loadRouteModule<{
              GET: (
                request: Request,
                context: { params: Promise<{ projectId: string }> | { projectId: string } },
              ) => Promise<Response>;
            }>("src/app/api/projects/[projectId]/detail/route.ts", {
              sessionToken: session.token,
            });

            const response = await route.GET(
              new Request(`http://localhost/api/projects/${project.id}/detail`),
              { params: { projectId: project.id } },
            );

            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual(
              expect.objectContaining({
                id: project.id,
                title: "Project Detail",
                scriptVersions: [
                  expect.objectContaining({
                    id: "script-version-2",
                    versionNumber: 2,
                    body: "Version two body",
                  }),
                  expect.objectContaining({
                    id: "script-version-1",
                    versionNumber: 1,
                    body: "Version one body",
                  }),
                ],
                storyboardVersions: [
                  expect.objectContaining({
                    id: "storyboard-version-1",
                    scriptVersionId: "script-version-2",
                    taskId: storyboardTask.id,
                    frameCount: 3,
                  }),
                ],
                imageAssets: [
                  expect.objectContaining({
                    id: "image-asset-detail",
                    mimeType: "image/png",
                    downloadUrl: "/api/assets/image-asset-detail/download",
                  }),
                ],
                videoAssets: [
                  expect.objectContaining({
                    id: "video-asset-detail",
                    mimeType: "video/mp4",
                    downloadUrl: "/api/assets/video-asset-detail/download",
                    previewUrl: "/api/assets/video-asset-detail/download",
                  }),
                ],
                taskHistory: [
                  expect.objectContaining({
                    id: videoTask.id,
                    type: TaskType.VIDEO,
                    status: TaskStatus.SUCCEEDED,
                  }),
                  expect.objectContaining({
                    id: imageTask.id,
                    type: TaskType.IMAGE,
                    status: TaskStatus.SUCCEEDED,
                  }),
                  expect.objectContaining({
                    id: storyboardTask.id,
                    type: TaskType.STORYBOARD,
                    status: TaskStatus.SUCCEEDED,
                  }),
                  expect.objectContaining({
                    id: scriptTask.id,
                    type: TaskType.SCRIPT_FINALIZE,
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

  it("streams image assets fully and video assets with range support", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-asset-download-"));

      try {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const user = await createActiveUser(prisma, "asset-download-owner");
            const session = await insertSessionForUser(prisma, user.id);
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Asset Download Project",
              },
            });
            const imageRelativePath = path.join("assets", project.id, "generated", "still.png");
            const videoRelativePath = path.join("assets", project.id, "generated", "shot.mp4");
            await writeAssetFile(storageRoot, imageRelativePath, ONE_BY_ONE_PNG_BYTES);
            await writeAssetFile(storageRoot, videoRelativePath, SAMPLE_MP4_BYTES);

            const [imageAsset, videoAsset] = await Promise.all([
              prisma.asset.create({
                data: {
                  id: "image-download-asset",
                  projectId: project.id,
                  kind: "image_generated",
                  storagePath: imageRelativePath,
                  originalName: "still.png",
                  mimeType: "image/png",
                  sizeBytes: ONE_BY_ONE_PNG_BYTES.length,
                },
              }),
              prisma.asset.create({
                data: {
                  id: "video-download-asset",
                  projectId: project.id,
                  kind: "video_generated",
                  storagePath: videoRelativePath,
                  originalName: "shot.mp4",
                  mimeType: "video/mp4",
                  sizeBytes: SAMPLE_MP4_BYTES.length,
                },
              }),
            ]);

            const route = await loadRouteModule<{
              GET: (
                request: Request,
                context: { params: Promise<{ assetId: string }> | { assetId: string } },
              ) => Promise<Response>;
            }>("src/app/api/assets/[assetId]/download/route.ts", {
              sessionToken: session.token,
            });

            const imageResponse = await route.GET(
              new Request(`http://localhost/api/assets/${imageAsset.id}/download`),
              { params: { assetId: imageAsset.id } },
            );

            expect(imageResponse.status).toBe(200);
            expect(imageResponse.headers.get("content-type")).toBe("image/png");
            expect(imageResponse.headers.get("content-length")).toBe(
              String(ONE_BY_ONE_PNG_BYTES.length),
            );
            await expect(imageResponse.arrayBuffer()).resolves.toEqual(
              ONE_BY_ONE_PNG_BYTES.buffer.slice(
                ONE_BY_ONE_PNG_BYTES.byteOffset,
                ONE_BY_ONE_PNG_BYTES.byteOffset + ONE_BY_ONE_PNG_BYTES.length,
              ),
            );

            const videoResponse = await route.GET(
              new Request(`http://localhost/api/assets/${videoAsset.id}/download`, {
                headers: {
                  range: "bytes=0-3",
                },
              }),
              { params: { assetId: videoAsset.id } },
            );

            expect(videoResponse.status).toBe(206);
            expect(videoResponse.headers.get("accept-ranges")).toBe("bytes");
            expect(videoResponse.headers.get("content-range")).toBe(
              `bytes 0-3/${SAMPLE_MP4_BYTES.length}`,
            );
            expect(videoResponse.headers.get("content-length")).toBe("4");
            await expect(videoResponse.arrayBuffer()).resolves.toEqual(
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

  it("returns not found when another user requests someone else's asset download", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-asset-private-"));

      try {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const owner = await createActiveUser(prisma, "asset-private-owner");
            const otherUser = await createActiveUser(prisma, "asset-private-other");
            const otherSession = await insertSessionForUser(prisma, otherUser.id);
            const project = await prisma.project.create({
              data: {
                ownerId: owner.id,
                title: "Private Asset Project",
              },
            });
            const videoRelativePath = path.join("assets", project.id, "generated", "private.mp4");
            await writeAssetFile(storageRoot, videoRelativePath, SAMPLE_MP4_BYTES);
            const asset = await prisma.asset.create({
              data: {
                id: "private-video-asset",
                projectId: project.id,
                kind: "video_generated",
                storagePath: videoRelativePath,
                originalName: "private.mp4",
                mimeType: "video/mp4",
                sizeBytes: SAMPLE_MP4_BYTES.length,
              },
            });

            const route = await loadRouteModule<{
              GET: (
                request: Request,
                context: { params: Promise<{ assetId: string }> | { assetId: string } },
              ) => Promise<Response>;
            }>("src/app/api/assets/[assetId]/download/route.ts", {
              sessionToken: otherSession.token,
            });

            const response = await route.GET(
              new Request(`http://localhost/api/assets/${asset.id}/download`),
              { params: { assetId: asset.id } },
            );

            expect(response.status).toBe(404);
            await expect(response.json()).resolves.toEqual({
              error: "Asset not found",
            });
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

  it("reads legacy backslash storage paths for previews and asset downloads", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-asset-backslash-"));

      try {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const user = await createActiveUser(prisma, "asset-backslash-owner");
            const session = await insertSessionForUser(prisma, user.id);
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Backslash Asset Project",
              },
            });
            const imageRelativePath = path.join("assets", project.id, "legacy", "still.png");
            await writeAssetFile(storageRoot, imageRelativePath, ONE_BY_ONE_PNG_BYTES);

            const imageAsset = await prisma.asset.create({
              data: {
                id: "image-backslash-asset",
                projectId: project.id,
                kind: "image_generated",
                storagePath: `assets\\${project.id}\\legacy\\still.png`,
                originalName: "still.png",
                mimeType: "image/png",
                sizeBytes: ONE_BY_ONE_PNG_BYTES.length,
              },
            });

            const detailRoute = await loadRouteModule<{
              GET: (
                request: Request,
                context: { params: Promise<{ projectId: string }> | { projectId: string } },
              ) => Promise<Response>;
            }>("src/app/api/projects/[projectId]/detail/route.ts", {
              sessionToken: session.token,
            });
            const detailResponse = await detailRoute.GET(
              new Request(`http://localhost/api/projects/${project.id}/detail`),
              { params: { projectId: project.id } },
            );

            expect(detailResponse.status).toBe(200);
            await expect(detailResponse.json()).resolves.toEqual(
              expect.objectContaining({
                imageAssets: [
                  expect.objectContaining({
                    id: imageAsset.id,
                    previewDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
                  }),
                ],
              }),
            );

            const downloadRoute = await loadRouteModule<{
              GET: (
                request: Request,
                context: { params: Promise<{ assetId: string }> | { assetId: string } },
              ) => Promise<Response>;
            }>("src/app/api/assets/[assetId]/download/route.ts", {
              sessionToken: session.token,
            });
            const downloadResponse = await downloadRoute.GET(
              new Request(`http://localhost/api/assets/${imageAsset.id}/download`),
              { params: { assetId: imageAsset.id } },
            );

            expect(downloadResponse.status).toBe(200);
            await expect(downloadResponse.arrayBuffer()).resolves.toEqual(
              ONE_BY_ONE_PNG_BYTES.buffer.slice(
                ONE_BY_ONE_PNG_BYTES.byteOffset,
                ONE_BY_ONE_PNG_BYTES.byteOffset + ONE_BY_ONE_PNG_BYTES.length,
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
});
