import { TaskStatus } from "@prisma/client";
import { Worker } from "bullmq";
import { prisma } from "@/lib/db";
import { connection } from "@/lib/redis";

type WorkerJobData = {
  taskId: string;
  taskStepId: string;
  traceId: string;
};

async function runMinimalTask(job: { data: WorkerJobData }) {
  const result = {
    ok: true as const,
    traceId: job.data.traceId,
  };

  await prisma.task.update({
    where: {
      id: job.data.taskId,
    },
    data: {
      status: TaskStatus.RUNNING,
      startedAt: new Date(),
    },
  });

  await prisma.taskStep.update({
    where: {
      id: job.data.taskStepId,
    },
    data: {
      status: TaskStatus.RUNNING,
    },
  });

  await prisma.task.update({
    where: {
      id: job.data.taskId,
    },
    data: {
      status: TaskStatus.SUCCEEDED,
      finishedAt: new Date(),
      outputJson: result,
    },
  });

  await prisma.taskStep.update({
    where: {
      id: job.data.taskStepId,
    },
    data: {
      status: TaskStatus.SUCCEEDED,
      outputJson: result,
    },
  });

  return result;
}

export function createVideoWorker() {
  return new Worker("video-queue", runMinimalTask, {
    connection: connection as any,
  });
}
