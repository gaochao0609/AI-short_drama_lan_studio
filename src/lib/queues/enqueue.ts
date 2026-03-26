import { randomUUID } from "node:crypto";
import { Prisma, TaskStatus, TaskType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getQueueForTaskType } from "@/lib/queues";
import { ServiceError } from "@/lib/services/errors";

type QueuePayload = {
  taskId: string;
  taskStepId: string;
  type: TaskType;
  traceId: string;
  payload: unknown;
};

const AUTO_RETRY_ATTEMPTS: Record<TaskType, number> = {
  [TaskType.SCRIPT_FINALIZE]: 3,
  [TaskType.STORYBOARD]: 3,
  [TaskType.IMAGE]: 2,
  [TaskType.VIDEO]: 2,
};

export async function enqueueTask(
  taskId: string,
  type: TaskType,
  payload: unknown,
): Promise<{ jobId: string; queueName: string }> {
  const task = await prisma.task.findUnique({
    where: {
      id: taskId,
    },
    select: {
      id: true,
      type: true,
    },
  });

  if (!task) {
    throw new ServiceError(404, "Task not found");
  }

  if (task.type !== type) {
    throw new ServiceError(409, "Task type mismatch");
  }

  const traceId = randomUUID();
  const step = await prisma.taskStep.create({
    data: {
      taskId,
      stepKey: task.type,
      status: TaskStatus.QUEUED,
      inputJson: {
        payload,
        traceId,
        type: task.type,
      } as Prisma.InputJsonValue,
    },
    select: {
      id: true,
    },
  });

  const queue = getQueueForTaskType(task.type);
  const jobData: QueuePayload = {
    taskId,
    taskStepId: step.id,
    type: task.type,
    traceId,
    payload,
  };

  try {
    const job = await queue.add(task.type, jobData, {
      attempts: AUTO_RETRY_ATTEMPTS[task.type],
      jobId: step.id,
      removeOnComplete: true,
      removeOnFail: false,
    });

    return {
      jobId: job.id ?? step.id,
      queueName: queue.name,
    };
  } catch (error) {
    const errorText = error instanceof Error ? error.message : "Failed to enqueue task";

    await prisma.$transaction([
      prisma.taskStep.deleteMany({
        where: {
          id: step.id,
        },
      }),
      prisma.task.update({
        where: {
          id: task.id,
        },
        data: {
          status: TaskStatus.FAILED,
          finishedAt: new Date(),
          errorText,
        },
      }),
    ]);

    throw error;
  }
}
