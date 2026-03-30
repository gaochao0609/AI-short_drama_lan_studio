import { Prisma, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

type CancellableJobData = {
  taskId: string;
  taskStepId: string;
};

export async function cancelTaskIfRequested(jobData: CancellableJobData) {
  const task = await prisma.task.findUnique({
    where: {
      id: jobData.taskId,
    },
    select: {
      id: true,
      cancelRequestedAt: true,
    },
  });

  if (!task?.cancelRequestedAt) {
    return false;
  }

  const finishedAt = new Date();

  await prisma.$transaction([
    prisma.task.update({
      where: {
        id: jobData.taskId,
      },
      data: {
        status: TaskStatus.CANCELED,
        finishedAt,
        outputJson: Prisma.DbNull,
        errorText: "Canceled by admin",
      },
    }),
    prisma.taskStep.update({
      where: {
        id: jobData.taskStepId,
      },
      data: {
        status: TaskStatus.CANCELED,
        errorText: "Canceled by admin",
      },
    }),
  ]);

  return true;
}
