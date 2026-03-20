import { TaskStatus, TaskType, UserRole, UserStatus } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTestDatabase } from "../db/test-database";
import { withApiTestEnv } from "../api/test-api";

afterEach(() => {
  vi.doUnmock("next/headers");
  vi.resetModules();
});

async function withQueueTestEnv<T>(
  databaseUrl: string,
  callback: () => Promise<T>,
) {
  return withApiTestEnv(
    databaseUrl,
    callback,
    {
      REDIS_URL: "redis://127.0.0.1:6379/15",
    },
  );
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

  it("enqueues a job with the task type as the job name and records a task step", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withQueueTestEnv(databaseUrl, async () => {
        const { connection } = await import("@/lib/redis");
        const { queues } = await import("@/lib/queues");
        const { enqueueTask } = await import("@/lib/queues/enqueue");

        try {
          const user = await prisma.user.create({
            data: {
              username: "queue-bootstrap-user",
              passwordHash: "hash-for-queue-bootstrap-user",
              role: UserRole.USER,
              status: UserStatus.ACTIVE,
              forcePasswordChange: false,
            },
          });
          const project = await prisma.project.create({
            data: {
              ownerId: user.id,
              title: "Queue Bootstrap Project",
            },
          });
          const task = await prisma.task.create({
            data: {
              projectId: project.id,
              createdById: user.id,
              type: TaskType.IMAGE,
              inputJson: {
                prompt: "Generate key art",
              },
            },
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

          const step = await prisma.taskStep.findFirstOrThrow({
            where: {
              taskId: task.id,
            },
            orderBy: {
              createdAt: "desc",
            },
          });

          expect(step).toEqual(
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
        } finally {
          await connection.quit();
        }
      });
    });
  });

  it("starts and closes the four worker runtimes", async () => {
    await withTestDatabase(async ({ databaseUrl }) => {
      await withQueueTestEnv(databaseUrl, async () => {
        const { startWorkerRuntime } = await import("@/worker/index");
        const runtime = await startWorkerRuntime();

        expect(runtime.workers).toHaveLength(4);
        expect(runtime.workers.map((worker) => worker.name)).toEqual([
          "script-queue",
          "storyboard-queue",
          "image-queue",
          "video-queue",
        ]);
        await runtime.close();
      });
    });
  });
});
