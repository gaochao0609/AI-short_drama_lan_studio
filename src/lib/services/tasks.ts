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

export async function listAdminTasks(input?: { page?: number; pageSize?: number }) {
  const page = Math.max(1, input?.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input?.pageSize ?? 50));

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      orderBy: [
        {
          createdAt: "desc",
        },
        {
          id: "desc",
        },
      ],
      select: ADMIN_TASK_SELECT,
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    prisma.task.count(),
  ]);

  return {
    tasks: tasks.map(toAdminTaskSummary),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
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

async function readCurrentTaskStatus(taskId: string) {
  const task = await prisma.task.findUnique({
    where: {
      id: taskId,
    },
    select: {
      id: true,
      status: true,
      cancelRequestedAt: true,
    },
  });

  if (!task) {
    throw new ServiceError(404, "Task not found");
  }

  return task;
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

  const updateResult = await prisma.task.updateMany({
    where: {
      id: task.id,
      status: {
        in: [TaskStatus.FAILED, TaskStatus.CANCELED],
      },
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

  if (updateResult.count !== 1) {
    const currentTask = await readCurrentTaskStatus(task.id);

    if (currentTask.status === TaskStatus.QUEUED || currentTask.status === TaskStatus.RUNNING) {
      throw new ServiceError(409, "Task retry is already in progress");
    }

    throw new ServiceError(409, "Only failed or canceled tasks can be retried");
  }

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

        const updateResult = await prisma.task.updateMany({
          where: {
            id: task.id,
            status: TaskStatus.QUEUED,
          },
          data: {
            cancelRequestedAt: now,
          },
        });

        if (updateResult.count !== 1) {
          const currentTask = await readCurrentTaskStatus(task.id);

          return {
            taskId: currentTask.id,
            status: currentTask.status,
            cancelRequestedAt: currentTask.cancelRequestedAt,
          };
        }

        return {
          taskId: task.id,
          status: TaskStatus.QUEUED,
          cancelRequestedAt: now,
        };
      }
    }

    const [taskUpdateResult] = await prisma.$transaction([
      prisma.task.updateMany({
        where: {
          id: task.id,
          status: TaskStatus.QUEUED,
        },
        data: {
          status: TaskStatus.CANCELED,
          cancelRequestedAt: now,
          finishedAt: now,
          outputJson: Prisma.DbNull,
          errorText: "Canceled by admin",
        },
      }),
      prisma.taskStep.updateMany({
        where: {
          id: latestStep.id,
          status: TaskStatus.QUEUED,
        },
        data: {
          status: TaskStatus.CANCELED,
          errorText: "Canceled by admin",
        },
      }),
    ]);

    if (taskUpdateResult.count !== 1) {
      const currentTask = await readCurrentTaskStatus(task.id);

      return {
        taskId: currentTask.id,
        status: currentTask.status,
        cancelRequestedAt: currentTask.cancelRequestedAt,
      };
    }

    return {
      taskId: task.id,
      status: TaskStatus.CANCELED,
      cancelRequestedAt: now,
    };
  }

  if (task.status === TaskStatus.RUNNING) {
    if (task.cancelRequestedAt) {
      const currentTask = await readCurrentTaskStatus(task.id);

      return {
        taskId: currentTask.id,
        status: currentTask.status,
        cancelRequestedAt: currentTask.cancelRequestedAt,
      };
    }

    const cancelRequestedAt = new Date();
    const updateResult = await prisma.task.updateMany({
      where: {
        id: task.id,
        status: TaskStatus.RUNNING,
      },
      data: {
        cancelRequestedAt,
      },
    });

    if (updateResult.count !== 1) {
      const currentTask = await readCurrentTaskStatus(task.id);

      return {
        taskId: currentTask.id,
        status: currentTask.status,
        cancelRequestedAt: currentTask.cancelRequestedAt,
      };
    }

    return {
      taskId: task.id,
      status: TaskStatus.RUNNING,
      cancelRequestedAt,
    };
  }

  throw new ServiceError(409, "Only queued or running tasks can be canceled");
}
