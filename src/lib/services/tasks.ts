import { Prisma, TaskStatus, TaskType } from "@prisma/client";
import { prisma } from "@/lib/db";
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

export async function updateTask(
  taskId: string,
  ownerId: string,
  input: {
    status?: TaskStatus;
    outputJson?: Prisma.InputJsonValue;
    errorText?: string | null;
  },
) {
  const task = await getTask(taskId, ownerId);
  const data: Prisma.TaskUpdateInput = {};

  if (input.status !== undefined) {
    data.status = input.status;
  }

  if (input.outputJson !== undefined) {
    data.outputJson = input.outputJson;
  }

  if (input.errorText !== undefined) {
    data.errorText = input.errorText;
  }

  return prisma.task.update({
    where: {
      id: task.id,
    },
    data,
  });
}
