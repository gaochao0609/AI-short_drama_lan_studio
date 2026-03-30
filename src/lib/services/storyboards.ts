import { Prisma, TaskType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { enqueueTask } from "@/lib/queues/enqueue";
import { getProject } from "@/lib/services/projects";
import { ServiceError } from "@/lib/services/errors";

export const StoryboardSegmentSchema = z.object({
  index: z.number().int().positive(),
  durationSeconds: z.literal(15),
  scene: z.string().trim().min(1),
  shot: z.string().trim().min(1),
  action: z.string().trim().min(1),
  dialogue: z.string(),
  videoPrompt: z.string().trim().min(1),
});

export const StoryboardSegmentsSchema = z.array(StoryboardSegmentSchema).min(1);

export type StoryboardSegment = z.infer<typeof StoryboardSegmentSchema>;

async function getOwnedScriptVersion(
  projectId: string,
  scriptVersionId: string,
  userId: string,
) {
  const scriptVersion = await prisma.scriptVersion.findFirst({
    where: {
      id: scriptVersionId,
      projectId,
      project: {
        ownerId: userId,
      },
    },
    select: {
      id: true,
      body: true,
    },
  });

  if (!scriptVersion) {
    throw new ServiceError(404, "Script version not found");
  }

  if (typeof scriptVersion.body !== "string" || !scriptVersion.body.trim()) {
    throw new ServiceError(409, "Script version is missing a script body");
  }

  return {
    ...scriptVersion,
    body: scriptVersion.body.trim(),
  };
}

export async function listProjectScriptVersions(projectId: string, userId: string) {
  await getProject(projectId, userId);

  return prisma.scriptVersion.findMany({
    where: {
      projectId,
    },
    orderBy: [
      {
        versionNumber: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
    select: {
      id: true,
      versionNumber: true,
      body: true,
      createdAt: true,
    },
  });
}

export async function createStoryboardTask(input: {
  projectId: string;
  scriptVersionId: string;
  userId: string;
}) {
  await getProject(input.projectId, input.userId);
  const scriptVersion = await getOwnedScriptVersion(
    input.projectId,
    input.scriptVersionId,
    input.userId,
  );

  const task = await prisma.task.create({
    data: {
      projectId: input.projectId,
      createdById: input.userId,
      type: TaskType.STORYBOARD,
      inputJson: {
        projectId: input.projectId,
        scriptVersionId: scriptVersion.id,
        userId: input.userId,
      } as Prisma.InputJsonValue,
    },
    select: {
      id: true,
    },
  });

  try {
    await enqueueTask(task.id, TaskType.STORYBOARD, {
      projectId: input.projectId,
      scriptVersionId: scriptVersion.id,
      userId: input.userId,
    });
  } catch (error) {
    await prisma.task.deleteMany({
      where: {
        id: task.id,
        projectId: input.projectId,
        createdById: input.userId,
        type: TaskType.STORYBOARD,
      },
    });

    throw error;
  }

  return {
    taskId: task.id,
  };
}
