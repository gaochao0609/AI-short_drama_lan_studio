import { TaskStatus, TaskType, UserRole, UserStatus, type PrismaClient } from "@prisma/client";
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
      const { connection } = await import("@/lib/redis");
      await connection.flushdb();

      try {
        return await callback();
      } finally {
        await connection.flushdb();
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

async function observeTaskProgress(prisma: PrismaClient, taskId: string, timeoutMs = 5_000) {
  const observedTaskStatuses = new Set<TaskStatus>();
  const observedStepStatuses = new Set<TaskStatus>();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: taskId },
    });
    const step = await prisma.taskStep.findFirst({
      where: { taskId },
      orderBy: { createdAt: "desc" },
    });

    observedTaskStatuses.add(task.status);
    if (step) {
      observedStepStatuses.add(step.status);
    }

    if (task.status === TaskStatus.SUCCEEDED && step?.status === TaskStatus.SUCCEEDED) {
      return {
        observedTaskStatuses,
        observedStepStatuses,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error(`Timed out waiting for task ${taskId} to finish`);
}

describe("queue bootstrap", () => {
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
        const { queues } = await import("@/lib/queues");
        const { enqueueTask } = await import("@/lib/queues/enqueue");
        const { startWorkerRuntime } = await import("@/worker/index");
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

        const runtime = await startWorkerRuntime();
        const progressPromise = observeTaskProgress(prisma, task.id);

        try {
          const progress = await progressPromise;
          expect(progress.observedTaskStatuses.has(TaskStatus.RUNNING)).toBe(true);
          expect(progress.observedTaskStatuses.has(TaskStatus.SUCCEEDED)).toBe(true);
          expect(progress.observedStepStatuses.has(TaskStatus.RUNNING)).toBe(true);
          expect(progress.observedStepStatuses.has(TaskStatus.SUCCEEDED)).toBe(true);

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
        }
      });
    });
  });
});
