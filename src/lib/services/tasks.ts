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
