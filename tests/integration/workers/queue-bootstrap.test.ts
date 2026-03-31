import { TaskStatus, TaskType, UserRole, UserStatus, type PrismaClient } from "@prisma/client";
import { QueueEvents } from "bullmq";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withApiTestEnv } from "../api/test-api";
import { withTestDatabase } from "../db/test-database";

afterEach(() => {
  vi.doUnmock("next/headers");
  vi.resetModules();
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

async function createOwnedTask(
  prisma: PrismaClient,
  input: {
    username: string;
    projectTitle: string;
    taskType: TaskType;
  },
) {
  const user = await prisma.user.create({
    data: {
      username: input.username,
      passwordHash: "hash-for-queue-bootstrap-user",
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      forcePasswordChange: false,
    },
  });
  const project = await prisma.project.create({
    data: {
      ownerId: user.id,
      title: input.projectTitle,
    },
  });

  return prisma.task.create({
    data: {
      projectId: project.id,
      createdById: user.id,
      type: input.taskType,
      inputJson: {
        prompt: "Generate key art",
      },
    },
  });
}

describe("queue bootstrap", () => {
  it.each([
    {
      taskType: TaskType.SCRIPT_FINALIZE,
      expectedQueueName: "script-queue",
      expectedAttempts: 3,
    },
    {
      taskType: TaskType.STORYBOARD,
      expectedQueueName: "storyboard-queue",
      expectedAttempts: 3,
    },
    {
      taskType: TaskType.IMAGE,
      expectedQueueName: "image-queue",
      expectedAttempts: 2,
    },
    {
      taskType: TaskType.VIDEO,
      expectedQueueName: "video-queue",
      expectedAttempts: 2,
    },
  ])(
    "configures BullMQ attempts for $taskType jobs",
    async ({ taskType, expectedQueueName, expectedAttempts }) => {
      await withTestDatabase(async ({ databaseUrl, prisma }) => {
        await withQueueTestEnv(databaseUrl, async () => {
          const [{ queues }, { enqueueTask }] = await Promise.all([
            import("@/lib/queues"),
            import("@/lib/queues/enqueue"),
          ]);
          const task = await createOwnedTask(prisma, {
            username: `queue-bootstrap-attempts-${taskType.toLowerCase()}`,
            projectTitle: `Attempts ${taskType}`,
            taskType,
          });
          const queue = Object.values(queues).find(
            (candidateQueue) => candidateQueue.name === expectedQueueName,
          );

          expect(queue).toBeDefined();

          const addSpy = vi.spyOn(queue!, "add");

          try {
            await enqueueTask(task.id, taskType, {
              prompt: "Generate asset",
            });

            expect(addSpy).toHaveBeenCalledWith(
              taskType,
              expect.objectContaining({
                taskId: task.id,
                type: taskType,
              }),
              expect.objectContaining({
                attempts: expectedAttempts,
                jobId: expect.any(String),
                removeOnComplete: true,
                removeOnFail: false,
              }),
            );
          } finally {
            addSpy.mockRestore();
          }
        });
      });
    },
  );

  it("exposes the four task queues", async () => {
    await withTestDatabase(async ({ databaseUrl }) => {
      await withQueueTestEnv(databaseUrl, async () => {
        const { queues } = await import("@/lib/queues");

        expect(Object.keys(queues).sort()).toEqual(["image", "script", "storyboard", "video"]);
        expect(queues.script.name).toBe("script-queue");
        expect(queues.storyboard.name).toBe("storyboard-queue");
        expect(queues.image.name).toBe("image-queue");
        expect(queues.video.name).toBe("video-queue");
      });
    });
  });

  it("rejects mismatched task types before enqueueing", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withQueueTestEnv(databaseUrl, async () => {
        const { enqueueTask } = await import("@/lib/queues/enqueue");
        const task = await createOwnedTask(prisma, {
          username: "queue-bootstrap-mismatch",
          projectTitle: "Mismatch Project",
          taskType: TaskType.IMAGE,
        });

        await expect(
          enqueueTask(task.id, TaskType.VIDEO, {
            prompt: "Generate key art",
          }),
        ).rejects.toThrow(/task type mismatch/i);

        await expect(
          prisma.task.findUniqueOrThrow({
            where: { id: task.id },
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            id: task.id,
            type: TaskType.IMAGE,
            status: TaskStatus.QUEUED,
            errorText: null,
          }),
        );
        expect(
          await prisma.taskStep.count({
            where: { taskId: task.id },
          }),
        ).toBe(0);
      });
    });
  });

  it("marks the task failed if queue enqueueing fails", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withQueueTestEnv(databaseUrl, async () => {
        const { queues } = await import("@/lib/queues");
        const { enqueueTask } = await import("@/lib/queues/enqueue");
        const task = await createOwnedTask(prisma, {
          username: "queue-bootstrap-failure",
          projectTitle: "Queue Failure Project",
          taskType: TaskType.IMAGE,
        });

        const enqueueError = new Error("queue unavailable");
        const addSpy = vi.spyOn(queues.image, "add").mockRejectedValueOnce(enqueueError);

        try {
          await expect(
            enqueueTask(task.id, TaskType.IMAGE, {
              prompt: "Generate key art",
            }),
          ).rejects.toThrow("queue unavailable");

          expect(addSpy).toHaveBeenCalledTimes(1);
          await expect(
            prisma.task.findUniqueOrThrow({
              where: { id: task.id },
            }),
          ).resolves.toEqual(
            expect.objectContaining({
              id: task.id,
              status: TaskStatus.FAILED,
              errorText: "queue unavailable",
            }),
          );
          expect(
            await prisma.taskStep.count({
              where: { taskId: task.id },
            }),
          ).toBe(0);
        } finally {
          addSpy.mockRestore();
        }
      });
    });
  });

  it("processes a job through running and succeeded states", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withQueueTestEnv(databaseUrl, async () => {
        const [{ queues }, { enqueueTask }] = await Promise.all([
          import("@/lib/queues"),
          import("@/lib/queues/enqueue"),
        ]);
        const { startWorkerRuntime } = await import("@/worker/index");
        const { bullmqConnection } = await import("@/lib/redis");
        const task = await createOwnedTask(prisma, {
          username: "queue-bootstrap-runtime",
          projectTitle: "Queue Runtime Project",
          taskType: TaskType.IMAGE,
        });

        const result = await enqueueTask(task.id, TaskType.IMAGE, {
          prompt: "Generate key art",
        });

        expect(result.queueName).toBe("image-queue");
        expect(result.jobId).toEqual(expect.any(String));

        const job = await queues.image.getJob(result.jobId);
        expect(job).not.toBeNull();
        expect(job?.name).toBe(TaskType.IMAGE);
        expect(job?.data).toEqual(
          expect.objectContaining({
            taskId: task.id,
            type: TaskType.IMAGE,
            traceId: expect.any(String),
          }),
        );

        const queuedStep = await prisma.taskStep.findFirstOrThrow({
          where: {
            taskId: task.id,
          },
          orderBy: {
            createdAt: "desc",
          },
        });

        expect(queuedStep).toEqual(
          expect.objectContaining({
            taskId: task.id,
            stepKey: TaskType.IMAGE,
            status: TaskStatus.QUEUED,
            inputJson: expect.objectContaining({
              payload: {
                prompt: "Generate key art",
              },
              traceId: expect.any(String),
            }),
          }),
        );

        const queueEvents = new QueueEvents(result.queueName, {
          connection: bullmqConnection,
        });
        await queueEvents.waitUntilReady();
        expect(job).not.toBeNull();
        const completionPromise = job!.waitUntilFinished(queueEvents);

        const runtime = await startWorkerRuntime();

        try {
          await expect(completionPromise).resolves.toEqual(
            expect.objectContaining({
              ok: true,
              traceId: expect.any(String),
            }),
          );

          await expect(
            prisma.task.findUniqueOrThrow({
              where: { id: task.id },
            }),
          ).resolves.toEqual(
            expect.objectContaining({
              id: task.id,
              status: TaskStatus.SUCCEEDED,
              outputJson: expect.objectContaining({
                ok: true,
                traceId: expect.any(String),
              }),
            }),
          );
          await expect(
            prisma.taskStep.findFirstOrThrow({
              where: { taskId: task.id },
              orderBy: { createdAt: "desc" },
            }),
          ).resolves.toEqual(
            expect.objectContaining({
              taskId: task.id,
              status: TaskStatus.SUCCEEDED,
              outputJson: expect.objectContaining({
                ok: true,
                traceId: expect.any(String),
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
