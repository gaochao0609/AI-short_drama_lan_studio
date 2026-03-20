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
    },
  });

  if (!task) {
    throw new ServiceError(404, "Task not found");
  }

  const traceId = randomUUID();
  const step = await prisma.taskStep.create({
    data: {
      taskId,
      stepKey: type,
      status: TaskStatus.QUEUED,
      inputJson: {
        payload,
        traceId,
        type,
      } as Prisma.InputJsonValue,
    },
    select: {
      id: true,
    },
  });

  const queue = getQueueForTaskType(type);
  const jobData: QueuePayload = {
    taskId,
    taskStepId: step.id,
    type,
    traceId,
    payload,
  };

  const job = await queue.add(type, jobData, {
    jobId: step.id,
    removeOnComplete: true,
    removeOnFail: false,
  });

  return {
    jobId: job.id ?? step.id,
    queueName: queue.name,
  };
}
