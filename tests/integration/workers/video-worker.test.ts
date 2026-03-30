import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import {
  TaskStatus,
  TaskType,
  UserRole,
  UserStatus,
  type PrismaClient,
} from "@prisma/client";
import { QueueEvents } from "bullmq";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withApiTestEnv } from "../api/test-api";
import { withTestDatabase } from "../db/test-database";

const { callProxyModelMock, getDefaultModelSummaryMock } = vi.hoisted(() => ({
  callProxyModelMock: vi.fn(),
  getDefaultModelSummaryMock: vi.fn(),
}));

vi.mock("@/lib/models/proxy-client", () => ({
  callProxyModel: callProxyModelMock,
}));

vi.mock("@/lib/models/provider-registry", () => ({
  getDefaultModelSummary: getDefaultModelSummaryMock,
}));

afterEach(() => {
  vi.resetModules();
  callProxyModelMock.mockReset();
  getDefaultModelSummaryMock.mockReset();
});

async function withQueueTestEnv<T>(
  databaseUrl: string,
  callback: () => Promise<T>,
  envOverrides: Record<string, string> = {},
) {
  return withApiTestEnv(
    databaseUrl,
    async () => {
      const [{ closeQueues }, { connection }] = await Promise.all([
        import("@/lib/queues"),
        import("@/lib/redis"),
      ]);

      await connection.flushdb();

      try {
        return await callback();
      } finally {
        await closeQueues();
        await connection.quit();
      }
    },
    {
      REDIS_URL: "redis://127.0.0.1:6379/14",
      ...envOverrides,
    },
  );
}

async function createActiveUser(prisma: PrismaClient, username: string) {
  return prisma.user.create({
    data: {
      username,
      passwordHash: "hash-for-video-worker-user",
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      forcePasswordChange: false,
    },
  });
}

async function createReferenceImage(
  prisma: PrismaClient,
  input: {
    projectId: string;
    storageRoot: string;
    name: string;
  },
) {
  const relativePath = path.join("assets", input.projectId, "references", input.name);
  const absolutePath = path.join(input.storageRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, ONE_BY_ONE_PNG_BYTES);

  return prisma.asset.create({
    data: {
      projectId: input.projectId,
      kind: "image_reference",
      storagePath: relativePath,
      originalName: input.name,
      mimeType: "image/png",
      sizeBytes: ONE_BY_ONE_PNG_BYTES.length,
      metadata: {
        role: "reference",
      },
    },
  });
}

function toDataUrl(mimeType: string, bytes: Uint8Array) {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

const ONE_BY_ONE_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7GZxkAAAAASUVORK5CYII=",
  "base64",
);

const SAMPLE_MP4_BYTES = Buffer.from("000000186674797069736F6D0000020069736F6D69736F32", "hex");

describe("video workflow", () => {
  it("creates VIDEO tasks with prompt and project-scoped reference images", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-video-enqueue-"));

      try {
        await withQueueTestEnv(
          databaseUrl,
          async () => {
            const [{ queues }, { enqueueVideoGeneration }] = await Promise.all([
              import("@/lib/queues"),
              import("@/lib/services/videos"),
            ]);

            const user = await createActiveUser(prisma, "video-enqueue-owner");
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Video Enqueue Project",
              },
            });
            const referenceAsset = await createReferenceImage(prisma, {
              projectId: project.id,
              storageRoot,
              name: "reference.png",
            });

            const result = await enqueueVideoGeneration({
              projectId: project.id,
              prompt: "Create a slow cinematic push-in from this storyboard frame.",
              referenceAssetIds: [referenceAsset.id],
              userId: user.id,
            });

            const task = await prisma.task.findUniqueOrThrow({
              where: { id: result.taskId },
            });
            const step = await prisma.taskStep.findFirstOrThrow({
              where: { taskId: result.taskId },
              orderBy: { createdAt: "desc" },
            });
            const job = await queues.video.getJob(step.id);

            expect(task.type).toBe(TaskType.VIDEO);
            expect(task.inputJson).toEqual(
              expect.objectContaining({
                projectId: project.id,
                userId: user.id,
                prompt: "Create a slow cinematic push-in from this storyboard frame.",
                referenceAssetIds: [referenceAsset.id],
              }),
            );
            expect(job).not.toBeNull();
            expect(job?.name).toBe(TaskType.VIDEO);
            expect(job?.data).toEqual(
              expect.objectContaining({
                taskId: result.taskId,
                type: TaskType.VIDEO,
                traceId: expect.any(String),
                payload: expect.objectContaining({
                  projectId: project.id,
                  prompt: "Create a slow cinematic push-in from this storyboard frame.",
                  referenceAssetIds: [referenceAsset.id],
                  userId: user.id,
                }),
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

  it("writes generated videos to assets on success", async () => {
    callProxyModelMock.mockResolvedValueOnce({
      status: "ok",
      fileOutputs: [toDataUrl("video/mp4", SAMPLE_MP4_BYTES)],
      rawResponse: {
        usage: {
          input: 220,
          output: 440,
        },
      },
    });
    getDefaultModelSummaryMock.mockResolvedValue({
      providerKey: "video",
      model: "veo-mini",
    });

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-video-success-"));

      try {
        await withQueueTestEnv(
          databaseUrl,
          async () => {
            const [{ enqueueVideoGeneration }, { queues }] = await Promise.all([
              import("@/lib/services/videos"),
              import("@/lib/queues"),
            ]);
            const { startWorkerRuntime } = await import("@/worker/index");
            const { bullmqConnection } = await import("@/lib/redis");

            const user = await createActiveUser(prisma, "video-success-owner");
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Video Success Project",
              },
            });
            const referenceAsset = await createReferenceImage(prisma, {
              projectId: project.id,
              storageRoot,
              name: "seed.png",
            });

            const { taskId } = await enqueueVideoGeneration({
              projectId: project.id,
              prompt: "Animate the frame into a subtle handheld shot.",
              referenceAssetIds: [referenceAsset.id],
              userId: user.id,
            });

            const step = await prisma.taskStep.findFirstOrThrow({
              where: { taskId },
              orderBy: { createdAt: "desc" },
            });
            const job = await queues.video.getJob(step.id);
            expect(job).not.toBeNull();

            const queueEvents = new QueueEvents(queues.video.name, {
              connection: bullmqConnection,
            });
            await queueEvents.waitUntilReady();
            const completionPromise = job!.waitUntilFinished(queueEvents);
            const runtime = await startWorkerRuntime();

            try {
              await expect(completionPromise).resolves.toEqual(
                expect.objectContaining({
                  ok: true,
                  traceId: expect.any(String),
                  outputAssetId: expect.any(String),
                }),
              );

              const asset = await prisma.asset.findFirstOrThrow({
                where: { taskId, projectId: project.id },
                orderBy: { createdAt: "desc" },
              });

              expect(asset).toEqual(
                expect.objectContaining({
                  projectId: project.id,
                  taskId,
                  kind: "video_generated",
                  mimeType: "video/mp4",
                  sizeBytes: SAMPLE_MP4_BYTES.length,
                }),
              );

              const filePath = path.isAbsolute(asset.storagePath)
                ? asset.storagePath
                : path.join(storageRoot, asset.storagePath);

              await expect(stat(filePath)).resolves.toBeDefined();
              await expect(readFile(filePath)).resolves.toEqual(SAMPLE_MP4_BYTES);

              await expect(
                prisma.task.findUniqueOrThrow({ where: { id: taskId } }),
              ).resolves.toEqual(
                expect.objectContaining({
                  id: taskId,
                  status: TaskStatus.SUCCEEDED,
                  outputJson: expect.objectContaining({
                    ok: true,
                    outputAssetId: asset.id,
                  }),
                }),
              );
            } finally {
              await runtime.close();
              await queueEvents.close();
            }
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

  it("marks tasks as failed when video generation errors", async () => {
    callProxyModelMock.mockResolvedValue({
      status: "error",
      errorMessage: "video model unavailable",
      rawResponse: {
        error: "upstream",
      },
    });
    getDefaultModelSummaryMock.mockResolvedValue({
      providerKey: "video",
      model: "veo-mini",
    });

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-video-failure-"));

      try {
        await withQueueTestEnv(
          databaseUrl,
          async () => {
            const { enqueueVideoGeneration } = await import("@/lib/services/videos");
            const { queues } = await import("@/lib/queues");
            const { startWorkerRuntime } = await import("@/worker/index");
            const { bullmqConnection } = await import("@/lib/redis");

            const user = await createActiveUser(prisma, "video-failure-owner");
            const project = await prisma.project.create({
              data: { ownerId: user.id, title: "Video Failure Project" },
            });
            const referenceAsset = await createReferenceImage(prisma, {
              projectId: project.id,
              storageRoot,
              name: "failure-seed.png",
            });

            const { taskId } = await enqueueVideoGeneration({
              projectId: project.id,
              prompt: "Animate something that will fail.",
              referenceAssetIds: [referenceAsset.id],
              userId: user.id,
            });

            const step = await prisma.taskStep.findFirstOrThrow({
              where: { taskId },
              orderBy: { createdAt: "desc" },
            });
            const job = await queues.video.getJob(step.id);
            expect(job).not.toBeNull();

            const queueEvents = new QueueEvents(queues.video.name, {
              connection: bullmqConnection,
            });
            await queueEvents.waitUntilReady();
            const completionPromise = job!.waitUntilFinished(queueEvents);
            const runtime = await startWorkerRuntime();

            try {
              await expect(completionPromise).rejects.toBeDefined();

              await expect(
                prisma.task.findUniqueOrThrow({ where: { id: taskId } }),
              ).resolves.toEqual(
                expect.objectContaining({
                  id: taskId,
                  status: TaskStatus.FAILED,
                  errorText: expect.stringMatching(/video model unavailable/i),
                }),
              );

              await expect(
                prisma.taskStep.findFirstOrThrow({
                  where: { taskId },
                  orderBy: { createdAt: "desc" },
                }),
              ).resolves.toEqual(
                expect.objectContaining({
                  taskId,
                  status: TaskStatus.FAILED,
                  errorText: expect.stringMatching(/video model unavailable/i),
                }),
              );
            } finally {
              await runtime.close();
              await queueEvents.close();
            }
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

  it("stops after a single automatic retry if video generation keeps failing", async () => {
    callProxyModelMock.mockResolvedValue({
      status: "error",
      errorMessage: "permanent video failure",
      rawResponse: null,
    });
    getDefaultModelSummaryMock.mockResolvedValue({
      providerKey: "video",
      model: "veo-mini",
    });

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-video-retry-"));

      try {
        await withQueueTestEnv(
          databaseUrl,
          async () => {
            const { enqueueVideoGeneration } = await import("@/lib/services/videos");
            const { queues } = await import("@/lib/queues");
            const { startWorkerRuntime } = await import("@/worker/index");
            const { bullmqConnection } = await import("@/lib/redis");

            const user = await createActiveUser(prisma, "video-retry-owner");
            const project = await prisma.project.create({
              data: { ownerId: user.id, title: "Video Retry Project" },
            });
            const referenceAsset = await createReferenceImage(prisma, {
              projectId: project.id,
              storageRoot,
              name: "retry-seed.png",
            });

            const { taskId } = await enqueueVideoGeneration({
              projectId: project.id,
              prompt: "Animate something that fails twice.",
              referenceAssetIds: [referenceAsset.id],
              userId: user.id,
            });

            const step = await prisma.taskStep.findFirstOrThrow({
              where: { taskId },
              orderBy: { createdAt: "desc" },
            });
            const job = await queues.video.getJob(step.id);
            expect(job).not.toBeNull();

            const queueEvents = new QueueEvents(queues.video.name, {
              connection: bullmqConnection,
            });
            await queueEvents.waitUntilReady();
            const completionPromise = job!.waitUntilFinished(queueEvents);
            const runtime = await startWorkerRuntime();

            try {
              await expect(completionPromise).rejects.toBeDefined();

              expect(callProxyModelMock).toHaveBeenCalledTimes(2);

              const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
              expect(task.status).toBe(TaskStatus.FAILED);

              const taskStep = await prisma.taskStep.findFirstOrThrow({
                where: { taskId },
                orderBy: { createdAt: "desc" },
              });
              expect(taskStep.status).toBe(TaskStatus.FAILED);
              expect(taskStep.retryCount).toBe(2);
            } finally {
              await runtime.close();
              await queueEvents.close();
            }
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
