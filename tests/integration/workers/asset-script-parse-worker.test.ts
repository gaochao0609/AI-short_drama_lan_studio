import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import {
  AssetCategory,
  AssetOrigin,
  Prisma,
  TaskStatus,
  TaskType,
  UserRole,
  UserStatus,
  type PrismaClient,
} from "@prisma/client";
import type { Job } from "bullmq";
import { QueueEvents } from "bullmq";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withApiTestEnv } from "../api/test-api";
import { withTestDatabase } from "../db/test-database";

afterEach(() => {
  vi.doUnmock("next/headers");
  vi.resetModules();
});

async function withQueueTestEnv<T>(
  databaseUrl: string,
  callback: () => Promise<T>,
  envOverrides: Record<string, string> = {},
) {
  return withApiTestEnv(
    databaseUrl,
    async () => {
      const [{ closeQueues }, { getRedisClient }] = await Promise.all([
        import("@/lib/queues"),
        import("@/lib/redis"),
      ]);
      const connection = getRedisClient();

      await connection.flushdb();

      try {
        return await callback();
      } finally {
        await closeQueues();
        await connection.quit();
      }
    },
    {
      REDIS_URL: "redis://127.0.0.1:6379/13",
      ...envOverrides,
    },
  );
}

async function createActiveUser(prisma: PrismaClient, username: string) {
  return prisma.user.create({
    data: {
      username,
      passwordHash: "hash-for-script-parse-worker-user",
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      forcePasswordChange: false,
    },
  });
}

async function createScriptSourceAsset(input: {
  prisma: PrismaClient;
  projectId: string;
  storageRoot: string;
  fileName: string;
  mimeType: string;
  fileBytes: Uint8Array;
  parseStatus?: "pending" | "failed" | "ready";
  parseError?: string;
}) {
  const relativePath = path.join("assets", input.projectId, "uploads", "scripts", input.fileName);
  const absolutePath = path.join(input.storageRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, input.fileBytes);

  const metadata: Record<string, Prisma.InputJsonValue> = {
    originalFileName: input.fileName,
    extension: path.extname(input.fileName).toLowerCase(),
    parseStatus: input.parseStatus ?? "pending",
  };

  if (input.parseError) {
    metadata.parseError = input.parseError;
  }

  const asset = await input.prisma.asset.create({
    data: {
      projectId: input.projectId,
      kind: "script_source",
      category: AssetCategory.SCRIPT_SOURCE,
      origin: AssetOrigin.UPLOAD,
      storagePath: relativePath,
      originalName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.fileBytes.length,
      metadata,
    },
  });

  return {
    asset,
    absolutePath,
  };
}

async function createParseTaskStep(input: {
  prisma: PrismaClient;
  projectId: string;
  userId: string;
  payload: {
    projectId: string;
    userId: string;
    assetId: string;
  };
}) {
  const task = await input.prisma.task.create({
    data: {
      projectId: input.projectId,
      createdById: input.userId,
      type: TaskType.ASSET_SCRIPT_PARSE,
      inputJson: input.payload as Prisma.InputJsonValue,
    },
    select: {
      id: true,
      type: true,
    },
  });
  const taskStep = await input.prisma.taskStep.create({
    data: {
      taskId: task.id,
      stepKey: task.type,
      status: TaskStatus.QUEUED,
      inputJson: {
        payload: input.payload,
        traceId: "trace-red-test",
        type: TaskType.ASSET_SCRIPT_PARSE,
      } as Prisma.InputJsonValue,
    },
    select: {
      id: true,
    },
  });

  return {
    taskId: task.id,
    taskStepId: taskStep.id,
  };
}

async function enqueueParseTask(input: {
  prisma: PrismaClient;
  projectId: string;
  userId: string;
  assetId: string;
}) {
  const { enqueueTask } = await import("@/lib/queues/enqueue");
  const { getQueueForTaskType } = await import("@/lib/queues");

  const payload = {
    projectId: input.projectId,
    userId: input.userId,
    assetId: input.assetId,
  };
  const task = await input.prisma.task.create({
    data: {
      projectId: input.projectId,
      createdById: input.userId,
      type: TaskType.ASSET_SCRIPT_PARSE,
      inputJson: payload,
    },
    select: {
      id: true,
    },
  });
  const enqueueResult = await enqueueTask(task.id, TaskType.ASSET_SCRIPT_PARSE, payload);
  const queue = getQueueForTaskType(TaskType.ASSET_SCRIPT_PARSE);
  const job = await queue.getJob(enqueueResult.jobId);

  if (!job) {
    throw new Error("Parse queue job was not found after enqueue");
  }

  return {
    taskId: task.id,
    queueName: enqueueResult.queueName,
    job,
  };
}

async function waitForJobCompletion(
  job: Job,
  queueName: string,
  timeoutMs = 8_000,
) {
  const { bullmqConnection } = await import("@/lib/redis");
  const queueEvents = new QueueEvents(queueName, {
    connection: bullmqConnection,
  });
  await queueEvents.waitUntilReady();

  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Timed out waiting for job ${job.id}`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([job.waitUntilFinished(queueEvents), timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    await queueEvents.close();
  }
}

function readMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  return metadata as Record<string, unknown>;
}

describe("asset script parse worker", () => {
  it("marks .txt script assets as ready and stores extracted text", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-parse-worker-txt-"));

      try {
        await withQueueTestEnv(
          databaseUrl,
          async () => {
            const { startWorkerRuntime } = await import("@/worker/index");
            const user = await createActiveUser(prisma, "parse-worker-txt-owner");
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Parse Worker TXT Project",
              },
            });
            const { asset } = await createScriptSourceAsset({
              prisma,
              projectId: project.id,
              storageRoot,
              fileName: "scene.txt",
              mimeType: "text/plain",
              fileBytes: Buffer.from("INT. ROOFTOP - NIGHT\r\nA courier arrives."),
            });

            const runtime = await startWorkerRuntime();

            try {
              const enqueued = await enqueueParseTask({
                prisma,
                projectId: project.id,
                userId: user.id,
                assetId: asset.id,
              });

              await expect(
                waitForJobCompletion(enqueued.job, enqueued.queueName),
              ).resolves.toEqual(
                expect.objectContaining({
                  ok: true,
                  assetId: asset.id,
                }),
              );

              const parsedAsset = await prisma.asset.findUniqueOrThrow({
                where: {
                  id: asset.id,
                },
              });
              const metadata = readMetadata(parsedAsset.metadata);

              expect(metadata.parseStatus).toBe("ready");
              expect(metadata.extractedText).toEqual(
                expect.stringContaining("INT. ROOFTOP - NIGHT"),
              );
              expect(metadata.parseError).toBeUndefined();

              await expect(
                prisma.task.findUniqueOrThrow({
                  where: {
                    id: enqueued.taskId,
                  },
                }),
              ).resolves.toEqual(
                expect.objectContaining({
                  id: enqueued.taskId,
                  status: TaskStatus.SUCCEEDED,
                }),
              );
            } finally {
              await runtime.close();
            }
          },
          { STORAGE_ROOT: storageRoot },
        );
      } finally {
        await rm(storageRoot, { recursive: true, force: true });
      }
    });
  }, 30_000);

  it("marks .md script assets as ready with normalized UTF-8 text", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-parse-worker-md-"));

      try {
        await withQueueTestEnv(
          databaseUrl,
          async () => {
            const { startWorkerRuntime } = await import("@/worker/index");
            const user = await createActiveUser(prisma, "parse-worker-md-owner");
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Parse Worker MD Project",
              },
            });
            const { asset } = await createScriptSourceAsset({
              prisma,
              projectId: project.id,
              storageRoot,
              fileName: "scene.md",
              mimeType: "text/markdown",
              fileBytes: Buffer.from("\uFEFF# INT. ROOFTOP - NIGHT\r\n- Courier arrives.\r\n"),
            });

            const runtime = await startWorkerRuntime();

            try {
              const enqueued = await enqueueParseTask({
                prisma,
                projectId: project.id,
                userId: user.id,
                assetId: asset.id,
              });

              await expect(
                waitForJobCompletion(enqueued.job, enqueued.queueName),
              ).resolves.toEqual(
                expect.objectContaining({
                  ok: true,
                  assetId: asset.id,
                }),
              );

              const parsedAsset = await prisma.asset.findUniqueOrThrow({
                where: {
                  id: asset.id,
                },
              });
              const metadata = readMetadata(parsedAsset.metadata);
              const extractedText = typeof metadata.extractedText === "string" ? metadata.extractedText : "";

              expect(metadata.parseStatus).toBe("ready");
              expect(extractedText).toContain("# INT. ROOFTOP - NIGHT");
              expect(extractedText).toContain("\n- Courier arrives.\n");
              expect(extractedText.startsWith("\uFEFF")).toBe(false);
              expect(extractedText).not.toContain("\r");
            } finally {
              await runtime.close();
            }
          },
          { STORAGE_ROOT: storageRoot },
        );
      } finally {
        await rm(storageRoot, { recursive: true, force: true });
      }
    });
  }, 30_000);

  it("marks unsupported script files as failed and stores parse error text", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(
        path.join(os.tmpdir(), "lan-studio-parse-worker-unsupported-"),
      );

      try {
        await withQueueTestEnv(
          databaseUrl,
          async () => {
            const { startWorkerRuntime } = await import("@/worker/index");
            const user = await createActiveUser(prisma, "parse-worker-unsupported-owner");
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Parse Worker Unsupported Project",
              },
            });
            const { asset } = await createScriptSourceAsset({
              prisma,
              projectId: project.id,
              storageRoot,
              fileName: "scene.rtf",
              mimeType: "application/rtf",
              fileBytes: Buffer.from("{\\rtf1\\ansi"),
            });

            const runtime = await startWorkerRuntime();

            try {
              const enqueued = await enqueueParseTask({
                prisma,
                projectId: project.id,
                userId: user.id,
                assetId: asset.id,
              });

              await expect(
                waitForJobCompletion(enqueued.job, enqueued.queueName),
              ).rejects.toBeDefined();

              const failedAsset = await prisma.asset.findUniqueOrThrow({
                where: {
                  id: asset.id,
                },
              });
              const metadata = readMetadata(failedAsset.metadata);

              expect(metadata.parseStatus).toBe("failed");
              expect(metadata.parseError).toEqual(expect.stringMatching(/unsupported/i));

              await expect(
                prisma.task.findUniqueOrThrow({
                  where: {
                    id: enqueued.taskId,
                  },
                }),
              ).resolves.toEqual(
                expect.objectContaining({
                  id: enqueued.taskId,
                  status: TaskStatus.FAILED,
                }),
              );
            } finally {
              await runtime.close();
            }
          },
          { STORAGE_ROOT: storageRoot },
        );
      } finally {
        await rm(storageRoot, { recursive: true, force: true });
      }
    });
  }, 30_000);

  it("marks malformed UTF-8 script files as failed", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-parse-worker-malformed-"));

      try {
        await withQueueTestEnv(
          databaseUrl,
          async () => {
            const { startWorkerRuntime } = await import("@/worker/index");
            const user = await createActiveUser(prisma, "parse-worker-malformed-owner");
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Parse Worker Malformed Project",
              },
            });
            const malformedBytes = Buffer.from([0x49, 0x4e, 0x54, 0x2e, 0x20, 0xc3, 0x28]);
            const { asset } = await createScriptSourceAsset({
              prisma,
              projectId: project.id,
              storageRoot,
              fileName: "scene.txt",
              mimeType: "text/plain",
              fileBytes: malformedBytes,
            });

            const runtime = await startWorkerRuntime();

            try {
              const enqueued = await enqueueParseTask({
                prisma,
                projectId: project.id,
                userId: user.id,
                assetId: asset.id,
              });

              await expect(
                waitForJobCompletion(enqueued.job, enqueued.queueName),
              ).rejects.toBeDefined();

              const failedAsset = await prisma.asset.findUniqueOrThrow({
                where: {
                  id: asset.id,
                },
              });
              const metadata = readMetadata(failedAsset.metadata);

              expect(metadata.parseStatus).toBe("failed");
              expect(metadata.parseError).toEqual(expect.stringMatching(/utf-8|decode|malformed/i));
            } finally {
              await runtime.close();
            }
          },
          { STORAGE_ROOT: storageRoot },
        );
      } finally {
        await rm(storageRoot, { recursive: true, force: true });
      }
    });
  }, 30_000);

  it("retries parse on the same asset id without creating a new asset", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-parse-worker-retry-"));

      try {
        await withQueueTestEnv(
          databaseUrl,
          async () => {
            const { startWorkerRuntime } = await import("@/worker/index");
            const user = await createActiveUser(prisma, "parse-worker-retry-owner");
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Parse Worker Retry Project",
              },
            });
            const { asset, absolutePath } = await createScriptSourceAsset({
              prisma,
              projectId: project.id,
              storageRoot,
              fileName: "retry.txt",
              mimeType: "text/plain",
              fileBytes: Buffer.from([0x61, 0x62, 0xc3, 0x28]),
            });

            const runtime = await startWorkerRuntime();

            try {
              const firstAttempt = await enqueueParseTask({
                prisma,
                projectId: project.id,
                userId: user.id,
                assetId: asset.id,
              });
              await expect(
                waitForJobCompletion(firstAttempt.job, firstAttempt.queueName),
              ).rejects.toBeDefined();

              await prisma.asset.update({
                where: {
                  id: asset.id,
                },
                data: {
                  metadata: {
                    originalFileName: "retry.txt",
                    extension: ".txt",
                    parseStatus: "pending",
                  },
                },
              });
              await writeFile(absolutePath, Buffer.from("INT. ROOFTOP - NIGHT\nRetry succeeded."));

              const secondAttempt = await enqueueParseTask({
                prisma,
                projectId: project.id,
                userId: user.id,
                assetId: asset.id,
              });
              await expect(
                waitForJobCompletion(secondAttempt.job, secondAttempt.queueName),
              ).resolves.toEqual(
                expect.objectContaining({
                  ok: true,
                  assetId: asset.id,
                }),
              );

              const retriedAsset = await prisma.asset.findUniqueOrThrow({
                where: {
                  id: asset.id,
                },
              });
              const metadata = readMetadata(retriedAsset.metadata);

              expect(metadata.parseStatus).toBe("ready");
              expect(metadata.extractedText).toEqual(expect.stringContaining("INT. ROOFTOP"));
              expect(
                await prisma.asset.count({
                  where: {
                    projectId: project.id,
                    category: AssetCategory.SCRIPT_SOURCE,
                  },
                }),
              ).toBe(1);
            } finally {
              await runtime.close();
            }
          },
          { STORAGE_ROOT: storageRoot },
        );
      } finally {
        await rm(storageRoot, { recursive: true, force: true });
      }
    });
  }, 30_000);

  it("keeps parse status pending while automatic retries remain", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-parse-worker-race-"));

      try {
        await withQueueTestEnv(
          databaseUrl,
          async () => {
            const { processAssetScriptParseJob } = await import(
              "@/worker/processors/asset-script-parse"
            );
            const user = await createActiveUser(prisma, "parse-worker-race-owner");
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Parse Worker Race Project",
              },
            });
            const { asset } = await createScriptSourceAsset({
              prisma,
              projectId: project.id,
              storageRoot,
              fileName: "scene.rtf",
              mimeType: "application/rtf",
              fileBytes: Buffer.from("{\\rtf1\\ansi"),
            });
            const payload = {
              projectId: project.id,
              userId: user.id,
              assetId: asset.id,
            };
            const { taskId, taskStepId } = await createParseTaskStep({
              prisma,
              projectId: project.id,
              userId: user.id,
              payload,
            });
            const job = {
              data: {
                taskId,
                taskStepId,
                traceId: "trace-race",
                payload,
              },
              attemptsMade: 0,
              opts: {
                attempts: 3,
              },
            } as unknown as Job;

            await expect(processAssetScriptParseJob(job)).rejects.toThrow(/unsupported/i);

            const midRetryAsset = await prisma.asset.findUniqueOrThrow({
              where: {
                id: asset.id,
              },
            });
            const metadata = readMetadata(midRetryAsset.metadata);
            expect(metadata.parseStatus).toBe("pending");
            expect(metadata.parseError).toBeUndefined();

            await expect(
              prisma.task.findUniqueOrThrow({
                where: {
                  id: taskId,
                },
              }),
            ).resolves.toEqual(
              expect.objectContaining({
                id: taskId,
                status: TaskStatus.QUEUED,
                errorText: expect.stringMatching(/unsupported/i),
              }),
            );
            await expect(
              prisma.taskStep.findUniqueOrThrow({
                where: {
                  id: taskStepId,
                },
              }),
            ).resolves.toEqual(
              expect.objectContaining({
                id: taskStepId,
                status: TaskStatus.QUEUED,
                retryCount: 1,
                errorText: expect.stringMatching(/unsupported/i),
              }),
            );
          },
          { STORAGE_ROOT: storageRoot },
        );
      } finally {
        await rm(storageRoot, { recursive: true, force: true });
      }
    });
  }, 30_000);
});
