import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/services/errors";

export async function createProject(input: {
  ownerId: string;
  title: string;
  idea?: string | null;
}) {
  return prisma.project.create({
    data: {
      ownerId: input.ownerId,
      title: input.title,
      idea: input.idea ?? null,
    },
  });
}

export async function listProjects(ownerId: string) {
  return prisma.project.findMany({
    where: {
      ownerId,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });
}

export async function listRecentProjects(ownerId: string, limit = 5) {
  return prisma.project.findMany({
    where: {
      ownerId,
    },
    orderBy: {
      updatedAt: "desc",
    },
    take: limit,
  });
}

export async function getProject(projectId: string, ownerId: string) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ownerId,
    },
  });

  if (!project) {
    throw new ServiceError(404, "Project not found");
  }

  return project;
}

export async function updateProject(
  projectId: string,
  ownerId: string,
  input: {
    title?: string;
    idea?: string | null;
    status?: string;
  },
) {
  const project = await getProject(projectId, ownerId);

  return prisma.project.update({
    where: {
      id: project.id,
    },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.idea !== undefined ? { idea: input.idea } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });
}
