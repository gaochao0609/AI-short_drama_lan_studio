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
  vi.doUnmock("next/headers");
  vi.resetModules();
  callProxyModelMock.mockReset();
  getDefaultModelSummaryMock.mockReset();
});

async function withQueueTestEnv<T>(databaseUrl: string, callback: () => Promise<T>) {
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
      REDIS_URL: "redis://127.0.0.1:6379/15",
    },
  );
}

async function createActiveUser(prisma: PrismaClient, username: string) {
  return prisma.user.create({
    data: {
      username,
      passwordHash: "hash-for-storyboard-worker-user",
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      forcePasswordChange: false,
    },
  });
}

describe("storyboard worker", () => {
  it("writes storyboard versions and task summaries for a queued storyboard job", async () => {
    const storyboardSegments = [
      {
        index: 1,
        durationSeconds: 15,
        scene: "Warehouse loading bay at night",
        shot: "Wide shot with a slow push-in",
        action: "Mina enters the empty bay and notices the lights flickering overhead.",
        dialogue: "Mina: We are already too late.",
        videoPrompt:
          "Cinematic warehouse loading bay at night, wide shot, slow push-in, tense suspense lighting",
      },
      {
        index: 2,
        durationSeconds: 15,
        scene: "Deeper inside the warehouse",
        shot: "Medium shot on Mina",
        action: "She spots the missing pedestal and realizes the relic has been moved.",
        dialogue: "Mina: The ledger is gone.",
        videoPrompt:
          "Moody medium shot of a courier discovering an empty pedestal inside a dim warehouse",
      },
    ];

    callProxyModelMock.mockResolvedValueOnce({
      status: "ok",
      textOutput: JSON.stringify(storyboardSegments),
      rawResponse: {
        usage: {
          input: 120,
          output: 220,
        },
      },
    });
    getDefaultModelSummaryMock.mockResolvedValue({
      providerKey: "storyboard",
      model: "gpt-4.1-mini",
    });

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withQueueTestEnv(databaseUrl, async () => {
        const [{ enqueueTask }, { queues }] = await Promise.all([
          import("@/lib/queues/enqueue"),
          import("@/lib/queues"),
        ]);
        const { startWorkerRuntime } = await import("@/worker/index");
        const { bullmqConnection } = await import("@/lib/redis");

        const user = await createActiveUser(prisma, "storyboard-worker-owner");
        const project = await prisma.project.create({
          data: {
            ownerId: user.id,
            title: "Storyboard Project",
          },
        });
        const scriptBody = [
          "INT. WAREHOUSE - NIGHT",
          "Mina enters the loading bay.",
          "She notices the lights flicker.",
          "The empty pedestal reveals the relic is gone.",
        ].join("\n");
        const scriptVersion = await prisma.scriptVersion.create({
          data: {
            projectId: project.id,
            creatorId: user.id,
            versionNumber: 1,
            body: scriptBody,
            scriptJson: {
              body: scriptBody,
            },
          },
        });
        const storyboardTask = await prisma.task.create({
          data: {
            projectId: project.id,
            createdById: user.id,
            type: TaskType.STORYBOARD,
            inputJson: {
              projectId: project.id,
              scriptVersionId: scriptVersion.id,
              userId: user.id,
            },
          },
        });

        const enqueueResult = await enqueueTask(
          storyboardTask.id,
          TaskType.STORYBOARD,
          {
            projectId: project.id,
            scriptVersionId: scriptVersion.id,
            userId: user.id,
          },
        );

        const job = await queues.storyboard.getJob(enqueueResult.jobId);
        expect(job).not.toBeNull();
        expect(job?.name).toBe(TaskType.STORYBOARD);

        const queueEvents = new QueueEvents(enqueueResult.queueName, {
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
              storyboardVersionId: expect.any(String),
              segments: storyboardSegments,
            }),
          );

          expect(callProxyModelMock).toHaveBeenCalledWith(
            expect.objectContaining({
              taskType: "storyboard_split",
              providerKey: "storyboard",
              model: "gpt-4.1-mini",
              inputText: expect.stringContaining(scriptBody),
              options: expect.objectContaining({
                projectId: project.id,
                scriptVersionId: scriptVersion.id,
                userId: user.id,
              }),
            }),
          );

          const storyboardVersion = await prisma.storyboardVersion.findFirstOrThrow({
            where: {
              taskId: storyboardTask.id,
            },
          });

          expect(storyboardVersion).toEqual(
            expect.objectContaining({
              projectId: project.id,
              scriptVersionId: scriptVersion.id,
              taskId: storyboardTask.id,
              modelProviderKey: "storyboard",
              modelName: "gpt-4.1-mini",
              framesJson: storyboardSegments,
            }),
          );
          await expect(
            prisma.task.findUniqueOrThrow({
              where: {
                id: storyboardTask.id,
              },
            }),
          ).resolves.toEqual(
            expect.objectContaining({
              id: storyboardTask.id,
              status: TaskStatus.SUCCEEDED,
              outputJson: expect.objectContaining({
                ok: true,
                storyboardVersionId: storyboardVersion.id,
                segments: storyboardSegments,
              }),
            }),
          );
          await expect(
            prisma.taskStep.findFirstOrThrow({
              where: {
                taskId: storyboardTask.id,
              },
              orderBy: {
                createdAt: "desc",
              },
            }),
          ).resolves.toEqual(
            expect.objectContaining({
              taskId: storyboardTask.id,
              status: TaskStatus.SUCCEEDED,
              retryCount: 0,
              outputJson: expect.objectContaining({
                ok: true,
                storyboardVersionId: storyboardVersion.id,
                segments: storyboardSegments,
              }),
            }),
          );
        } finally {
          await runtime.close();
          await queueEvents.close();
        }
      });
    });
  });

  it("retries a storyboard job after a transient model failure", async () => {
    const storyboardSegments = [
      {
        index: 1,
        durationSeconds: 15,
        scene: "Warehouse loading bay at night",
        shot: "Wide shot with a slow push-in",
        action: "Mina enters the empty bay and notices the lights flickering overhead.",
        dialogue: "Mina: We are already too late.",
        videoPrompt:
          "Cinematic warehouse loading bay at night, wide shot, slow push-in, tense suspense lighting",
      },
    ];

    callProxyModelMock
      .mockRejectedValueOnce(new Error("proxy unavailable"))
      .mockResolvedValueOnce({
        status: "ok",
        textOutput: JSON.stringify(storyboardSegments),
        rawResponse: {
          usage: {
            input: 90,
            output: 140,
          },
        },
      });
    getDefaultModelSummaryMock.mockResolvedValue({
      providerKey: "storyboard",
      model: "gpt-4.1-mini",
    });

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withQueueTestEnv(databaseUrl, async () => {
        const [{ enqueueTask }, { queues }] = await Promise.all([
          import("@/lib/queues/enqueue"),
          import("@/lib/queues"),
        ]);
        const { startWorkerRuntime } = await import("@/worker/index");
        const { bullmqConnection } = await import("@/lib/redis");

        const user = await createActiveUser(prisma, "storyboard-worker-retry");
        const project = await prisma.project.create({
          data: {
            ownerId: user.id,
            title: "Storyboard Retry Project",
          },
        });
        const scriptBody = [
          "INT. APARTMENT - MORNING",
          "The courier opens the envelope and freezes.",
        ].join("\n");
        const scriptVersion = await prisma.scriptVersion.create({
          data: {
            projectId: project.id,
            creatorId: user.id,
            versionNumber: 1,
            body: scriptBody,
            scriptJson: {
              body: scriptBody,
            },
          },
        });
        const storyboardTask = await prisma.task.create({
          data: {
            projectId: project.id,
            createdById: user.id,
            type: TaskType.STORYBOARD,
            inputJson: {
              projectId: project.id,
              scriptVersionId: scriptVersion.id,
              userId: user.id,
            },
          },
        });

        const enqueueResult = await enqueueTask(
          storyboardTask.id,
          TaskType.STORYBOARD,
          {
            projectId: project.id,
            scriptVersionId: scriptVersion.id,
            userId: user.id,
          },
        );

        const job = await queues.storyboard.getJob(enqueueResult.jobId);
        expect(job).not.toBeNull();

        const queueEvents = new QueueEvents(enqueueResult.queueName, {
          connection: bullmqConnection,
        });
        await queueEvents.waitUntilReady();
        const completionPromise = job!.waitUntilFinished(queueEvents);
        const runtime = await startWorkerRuntime();

        try {
          await expect(completionPromise).resolves.toEqual(
            expect.objectContaining({
              ok: true,
              storyboardVersionId: expect.any(String),
              segments: storyboardSegments,
            }),
          );

          expect(callProxyModelMock).toHaveBeenCalledTimes(2);
          await expect(
            prisma.task.findUniqueOrThrow({
              where: {
                id: storyboardTask.id,
              },
            }),
          ).resolves.toEqual(
            expect.objectContaining({
              id: storyboardTask.id,
              status: TaskStatus.SUCCEEDED,
              outputJson: expect.objectContaining({
                segments: storyboardSegments,
              }),
            }),
          );
          await expect(
            prisma.taskStep.findFirstOrThrow({
              where: {
                taskId: storyboardTask.id,
              },
              orderBy: {
                createdAt: "desc",
              },
            }),
          ).resolves.toEqual(
            expect.objectContaining({
              taskId: storyboardTask.id,
              status: TaskStatus.SUCCEEDED,
              retryCount: 1,
              outputJson: expect.objectContaining({
                segments: storyboardSegments,
              }),
            }),
          );
        } finally {
          await runtime.close();
          await queueEvents.close();
        }
      });
    });
  });
});
