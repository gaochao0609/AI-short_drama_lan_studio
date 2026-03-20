import { Prisma, TaskStatus } from "@prisma/client";
import type { Job, Worker } from "bullmq";
import { Worker as BullmqWorker } from "bullmq";
import { prisma } from "@/lib/db";
import { bullmqConnection } from "@/lib/redis";

export type MinimalWorkerJobData = {
  taskId: string;
  taskStepId: string;
  traceId: string;
};

export type MinimalWorkerResult = {
  ok: true;
  traceId: string;
};

async function writeTaskState(
  jobData: MinimalWorkerJobData,
  input: {
    status: TaskStatus;
    startedAt?: Date;
    finishedAt?: Date;
    outputJson?: MinimalWorkerResult | Prisma.NullTypes.DbNull;
    errorText?: string | null;
  },
) {
  await prisma.$transaction([
    prisma.task.update({
      where: {
        id: jobData.taskId,
      },
      data: {
        status: input.status,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        outputJson: input.outputJson,
        errorText: input.errorText,
      },
    }),
    prisma.taskStep.update({
      where: {
        id: jobData.taskStepId,
      },
      data: {
        status: input.status,
        outputJson: input.outputJson,
        errorText: input.errorText,
      },
    }),
  ]);
}

export async function runMinimalTask(
  job: Job<MinimalWorkerJobData, MinimalWorkerResult, string>,
): Promise<MinimalWorkerResult> {
  const result: MinimalWorkerResult = {
    ok: true,
    traceId: job.data.traceId,
  };

  try {
    await writeTaskState(job.data, {
      status: TaskStatus.RUNNING,
      startedAt: new Date(),
    });

    await writeTaskState(job.data, {
      status: TaskStatus.SUCCEEDED,
      finishedAt: new Date(),
      outputJson: result,
      errorText: null,
    });

    return result;
  } catch (error) {
    const errorText = error instanceof Error ? error.message : "Worker task failed";

    try {
      await writeTaskState(job.data, {
        status: TaskStatus.FAILED,
        finishedAt: new Date(),
        outputJson: Prisma.DbNull,
        errorText,
      });
    } catch {
      // Best-effort compensation. BullMQ will still mark the job failed.
    }

    throw error;
  }
}

export function createMinimalWorker(queueName: string): Worker<MinimalWorkerJobData, MinimalWorkerResult, string> {
  return new BullmqWorker(queueName, runMinimalTask, {
    connection: bullmqConnection,
  });
}
