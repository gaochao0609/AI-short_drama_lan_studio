import { Prisma, TaskStatus, TaskType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { enqueueTask } from "@/lib/queues/enqueue";
import { getQueueForTaskType } from "@/lib/queues";
import { ServiceError } from "@/lib/services/errors";

async function getOwnedProject(projectId: string, ownerId: string) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ownerId,
    },
    select: {
      id: true,
    },
  });

  if (!project) {
    throw new ServiceError(404, "Project not found");
  }

  return project;
}

export async function createTask(input: {
  projectId: string;
  createdById: string;
  type: TaskType;
  inputJson: Prisma.InputJsonValue;
}) {
  await getOwnedProject(input.projectId, input.createdById);

  return prisma.task.create({
    data: {
      projectId: input.projectId,
      createdById: input.createdById,
      type: input.type,
      inputJson: input.inputJson,
    },
  });
}

export async function listRecentTasks(ownerId: string, limit = 5) {
  return prisma.task.findMany({
    where: {
      project: {
        ownerId,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    take: limit,
    select: {
      id: true,
      projectId: true,
      type: true,
      status: true,
      createdAt: true,
    },
  });
}

export async function countFailedTasks(ownerId: string) {
  return prisma.task.count({
    where: {
      status: TaskStatus.FAILED,
      project: {
        ownerId,
      },
    },
  });
}

export async function getTask(taskId: string, ownerId: string) {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      project: {
        ownerId,
      },
    },
  });

  if (!task) {
    throw new ServiceError(404, "Task not found");
  }

  return task;
}

export async function listProjectTaskHistory(projectId: string, ownerId: string) {
  await getOwnedProject(projectId, ownerId);

  return prisma.task.findMany({
    where: {
      projectId,
      project: {
        ownerId,
      },
    },
    orderBy: [
      {
        createdAt: "desc",
      },
      {
        id: "desc",
      },
    ],
    select: {
      id: true,
      type: true,
      status: true,
      createdAt: true,
      finishedAt: true,
      errorText: true,
    },
  });
}

const ADMIN_TASK_SELECT = {
  id: true,
  type: true,
  status: true,
  errorText: true,
  inputJson: true,
  outputJson: true,
  cancelRequestedAt: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
  updatedAt: true,
  project: {
    select: {
      id: true,
      title: true,
      owner: {
        select: {
          id: true,
          username: true,
        },
      },
    },
  },
  createdBy: {
    select: {
      id: true,
      username: true,
    },
  },
  steps: {
    orderBy: [
      {
        createdAt: "desc",
      },
      {
        id: "desc",
      },
    ],
    select: {
      id: true,
      stepKey: true,
      status: true,
      retryCount: true,
      errorText: true,
      createdAt: true,
      log: true,
    },
  },
} satisfies Prisma.TaskSelect;

function toAdminTaskSummary(task: Prisma.TaskGetPayload<{ select: typeof ADMIN_TASK_SELECT }>) {
  return {
    id: task.id,
    type: task.type,
    status: task.status,
    errorText: task.errorText,
    inputJson: task.inputJson,
    outputJson: task.outputJson,
    cancelRequestedAt: task.cancelRequestedAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    project: {
      id: task.project.id,
      title: task.project.title,
      owner: task.project.owner,
    },
    createdBy: task.createdBy,
    latestStep: task.steps[0] ?? null,
    retryHistory: [...task.steps].reverse(),
  };
}

export async function listAdminTasks() {
  const tasks = await prisma.task.findMany({
    orderBy: [
      {
        createdAt: "desc",
      },
      {
        id: "desc",
      },
    ],
    select: ADMIN_TASK_SELECT,
    take: 100,
  });

  return tasks.map(toAdminTaskSummary);
}

function canRetryTask(status: TaskStatus) {
  return status === TaskStatus.FAILED || status === TaskStatus.CANCELED;
}

function isQueueRemoveRace(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("lock") || message.includes("locked") || message.includes("active");
}

export async function retryAdminTask(taskId: string) {
  const task = await prisma.task.findUnique({
    where: {
      id: taskId,
    },
    select: {
      id: true,
      type: true,
      status: true,
      inputJson: true,
    },
  });

  if (!task) {
    throw new ServiceError(404, "Task not found");
  }

  if (!canRetryTask(task.status)) {
    throw new ServiceError(409, "Only failed or canceled tasks can be retried");
  }

  await prisma.task.update({
    where: {
      id: task.id,
    },
    data: {
      status: TaskStatus.QUEUED,
      outputJson: Prisma.DbNull,
      errorText: null,
      cancelRequestedAt: null,
      startedAt: null,
      finishedAt: null,
    },
  });

  const enqueueResult = await enqueueTask(task.id, task.type, task.inputJson);

  return {
    taskId: task.id,
    status: TaskStatus.QUEUED,
    ...enqueueResult,
  };
}

export async function cancelAdminTask(taskId: string) {
  const task = await prisma.task.findUnique({
    where: {
      id: taskId,
    },
    select: {
      id: true,
      type: true,
      status: true,
      cancelRequestedAt: true,
      steps: {
        orderBy: [
          {
            createdAt: "desc",
          },
          {
            id: "desc",
          },
        ],
        take: 1,
        select: {
          id: true,
          status: true,
        },
      },
    },
  });

  if (!task) {
    throw new ServiceError(404, "Task not found");
  }

  if (task.status === TaskStatus.QUEUED) {
    const latestStep = task.steps[0];

    if (!latestStep || latestStep.status !== TaskStatus.QUEUED) {
      throw new ServiceError(409, "Task is not cancelable");
    }

    const now = new Date();
    const queue = getQueueForTaskType(task.type);
    const job = await queue.getJob(latestStep.id);

    if (job) {
      try {
        await job.remove();
      } catch (error) {
        if (!isQueueRemoveRace(error)) {
          throw error;
        }

        await prisma.task.update({
          where: {
            id: task.id,
          },
          data: {
            cancelRequestedAt: now,
          },
        });

        return {
          taskId: task.id,
          status: TaskStatus.QUEUED,
          cancelRequestedAt: now,
        };
      }
    }

    await prisma.$transaction([
      prisma.task.update({
        where: {
          id: task.id,
        },
        data: {
          status: TaskStatus.CANCELED,
          cancelRequestedAt: now,
          finishedAt: now,
          outputJson: Prisma.DbNull,
          errorText: "Canceled by admin",
        },
      }),
      prisma.taskStep.update({
        where: {
          id: latestStep.id,
        },
        data: {
          status: TaskStatus.CANCELED,
          errorText: "Canceled by admin",
        },
      }),
    ]);

    return {
      taskId: task.id,
      status: TaskStatus.CANCELED,
      cancelRequestedAt: now,
    };
  }

  if (task.status === TaskStatus.RUNNING) {
    const cancelRequestedAt = task.cancelRequestedAt ?? new Date();

    if (!task.cancelRequestedAt) {
      await prisma.task.update({
        where: {
          id: task.id,
        },
        data: {
          cancelRequestedAt,
        },
      });
    }

  return {
    taskId: task.id,
    status: TaskStatus.RUNNING,
    cancelRequestedAt,
  };
}

  throw new ServiceError(409, "Only queued or running tasks can be canceled");
}
