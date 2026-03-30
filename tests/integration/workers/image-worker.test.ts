import path from "node:path";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
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
import { insertSessionForUser, loadRouteModule, withApiTestEnv } from "../api/test-api";
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
  vi.doUnmock("next/headers");
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
      REDIS_URL: "redis://127.0.0.1:6379/15",
      ...envOverrides,
    },
  );
}

async function createActiveUser(prisma: PrismaClient, username: string) {
  return prisma.user.create({
    data: {
      username,
      passwordHash: "hash-for-image-worker-user",
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      forcePasswordChange: false,
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

describe("image workflow", () => {
  it("enqueues text-to-image jobs", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-image-enqueue-"));

      try {
        await withQueueTestEnv(
          databaseUrl,
          async () => {
            const [{ queues }, { enqueueImageGeneration }] = await Promise.all([
              import("@/lib/queues"),
              import("@/lib/services/images"),
            ]);

            const user = await createActiveUser(prisma, "image-enqueue-owner");
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Image Enqueue Project",
              },
            });

            const result = await enqueueImageGeneration({
              projectId: project.id,
              prompt: "Generate key art for the main character.",
              userId: user.id,
            });

            const step = await prisma.taskStep.findFirstOrThrow({
              where: { taskId: result.taskId },
              orderBy: { createdAt: "desc" },
            });
            const job = await queues.image.getJob(step.id);

            expect(job).not.toBeNull();
            expect(job?.name).toBe(TaskType.IMAGE);
            expect(job?.data).toEqual(
              expect.objectContaining({
                taskId: result.taskId,
                type: TaskType.IMAGE,
                traceId: expect.any(String),
                payload: expect.objectContaining({
                  projectId: project.id,
                  prompt: expect.any(String),
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

  it("records the source asset for image-to-image jobs", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-image-source-"));

      try {
        await withQueueTestEnv(
          databaseUrl,
          async () => {
            const { enqueueImageGeneration } = await import("@/lib/services/images");

            const user = await createActiveUser(prisma, "image-source-owner");
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Image Source Project",
              },
            });
            const referenceAsset = await prisma.asset.create({
              data: {
                projectId: project.id,
                kind: "image_reference",
                storagePath: "assets/reference.png",
                originalName: "reference.png",
                mimeType: "image/png",
                sizeBytes: ONE_BY_ONE_PNG_BYTES.length,
                metadata: {
                  note: "seed reference",
                },
              },
            });

            const result = await enqueueImageGeneration({
              projectId: project.id,
              prompt: "Make this look like a watercolor poster.",
              sourceAssetId: referenceAsset.id,
              userId: user.id,
            });

            const task = await prisma.task.findUniqueOrThrow({
              where: { id: result.taskId },
            });

            expect(task.type).toBe(TaskType.IMAGE);
            expect(task.inputJson).toEqual(
              expect.objectContaining({
                projectId: project.id,
                userId: user.id,
                prompt: expect.any(String),
                sourceAssetId: referenceAsset.id,
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

  it(
    "returns 413 when the uploaded reference image exceeds MAX_UPLOAD_MB",
    async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-image-413-"));

      try {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const user = await createActiveUser(prisma, "image-413-owner");
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Image 413 Project",
              },
            });
            const session = await insertSessionForUser(prisma, user.id);
            const route = await loadRouteModule<{
              POST: (request: Request) => Promise<Response>;
            }>("src/app/api/images/route.ts", {
              sessionToken: session.token,
            });

            const response = await route.POST(
              new Request("http://localhost/api/images", {
                method: "POST",
                headers: {
                  // Short-circuit before parsing multipart to avoid hanging on Request.formData() in jsdom/undici.
                  "content-length": String(2 * 1024 * 1024),
                  "content-type": "multipart/form-data; boundary=----vitest",
                },
                body: `projectId=${encodeURIComponent(project.id)}&prompt=ignored`,
              }),
            );

            expect(response.status).toBe(413);
            await expect(response.json()).resolves.toEqual(
              expect.objectContaining({
                error: expect.stringMatching(/payload too large/i),
              }),
            );
          },
          { STORAGE_ROOT: storageRoot, MAX_UPLOAD_MB: "1" },
        );
      } finally {
        await rm(storageRoot, { recursive: true, force: true });
      }
    });
    },
    20000,
  );

  it("writes generated images to assets on success", async () => {
    callProxyModelMock.mockResolvedValueOnce({
      status: "ok",
      fileOutputs: [toDataUrl("image/png", ONE_BY_ONE_PNG_BYTES)],
      rawResponse: {
        usage: {
          input: 120,
          output: 220,
        },
      },
    });
    getDefaultModelSummaryMock.mockResolvedValue({
      providerKey: "image",
      model: "gpt-image-1",
    });

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-image-success-"));

      try {
        await withQueueTestEnv(
          databaseUrl,
          async () => {
            const [{ enqueueImageGeneration }, { queues }] = await Promise.all([
              import("@/lib/services/images"),
              import("@/lib/queues"),
            ]);
            const { startWorkerRuntime } = await import("@/worker/index");
            const { bullmqConnection } = await import("@/lib/redis");

            const user = await createActiveUser(prisma, "image-success-owner");
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Image Success Project",
              },
            });

            const { taskId } = await enqueueImageGeneration({
              projectId: project.id,
              prompt: "Generate a cinematic key art still.",
              userId: user.id,
            });

            const step = await prisma.taskStep.findFirstOrThrow({
              where: { taskId },
              orderBy: { createdAt: "desc" },
            });
            const job = await queues.image.getJob(step.id);
            expect(job).not.toBeNull();

            const queueEvents = new QueueEvents(queues.image.name, {
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
                  mimeType: "image/png",
                  sizeBytes: ONE_BY_ONE_PNG_BYTES.length,
                }),
              );

              const filePath = path.isAbsolute(asset.storagePath)
                ? asset.storagePath
                : path.join(storageRoot, asset.storagePath);

              await expect(stat(filePath)).resolves.toBeDefined();
              await expect(readFile(filePath)).resolves.toEqual(ONE_BY_ONE_PNG_BYTES);

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

  it("preserves error logs when the job fails", async () => {
    callProxyModelMock.mockResolvedValue({
      status: "error",
      errorMessage: "model unavailable",
      rawResponse: {
        error: "upstream",
      },
    });
    getDefaultModelSummaryMock.mockResolvedValue({
      providerKey: "image",
      model: "gpt-image-1",
    });

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-image-failure-"));

      try {
        await withQueueTestEnv(
          databaseUrl,
          async () => {
            const { enqueueImageGeneration } = await import("@/lib/services/images");
            const { queues } = await import("@/lib/queues");
            const { startWorkerRuntime } = await import("@/worker/index");
            const { bullmqConnection } = await import("@/lib/redis");

            const user = await createActiveUser(prisma, "image-failure-owner");
            const project = await prisma.project.create({
              data: { ownerId: user.id, title: "Image Failure Project" },
            });

            const { taskId } = await enqueueImageGeneration({
              projectId: project.id,
              prompt: "Generate something that will fail.",
              userId: user.id,
            });

            const step = await prisma.taskStep.findFirstOrThrow({
              where: { taskId },
              orderBy: { createdAt: "desc" },
            });
            const job = await queues.image.getJob(step.id);
            expect(job).not.toBeNull();

            const queueEvents = new QueueEvents(queues.image.name, {
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
                  errorText: expect.stringMatching(/model unavailable/i),
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
                  errorText: expect.stringMatching(/model unavailable/i),
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

  it("stops after a single automatic retry if the job keeps failing", async () => {
    callProxyModelMock.mockResolvedValue({
      status: "error",
      errorMessage: "permanent failure",
      rawResponse: null,
    });
    getDefaultModelSummaryMock.mockResolvedValue({
      providerKey: "image",
      model: "gpt-image-1",
    });

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-image-retry-"));

      try {
        await withQueueTestEnv(
          databaseUrl,
          async () => {
            const { enqueueImageGeneration } = await import("@/lib/services/images");
            const { queues } = await import("@/lib/queues");
            const { startWorkerRuntime } = await import("@/worker/index");
            const { bullmqConnection } = await import("@/lib/redis");

            const user = await createActiveUser(prisma, "image-retry-owner");
            const project = await prisma.project.create({
              data: { ownerId: user.id, title: "Image Retry Project" },
            });

            const { taskId } = await enqueueImageGeneration({
              projectId: project.id,
              prompt: "Generate something that fails twice.",
              userId: user.id,
            });

            const step = await prisma.taskStep.findFirstOrThrow({
              where: { taskId },
              orderBy: { createdAt: "desc" },
            });
            const job = await queues.image.getJob(step.id);
            expect(job).not.toBeNull();

            const queueEvents = new QueueEvents(queues.image.name, {
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
