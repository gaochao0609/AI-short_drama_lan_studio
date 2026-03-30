import { Prisma, TaskStatus, TaskType } from "@prisma/client";
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

const StoryboardSegmentsBaseSchema = z.array(StoryboardSegmentSchema).min(1);

export const StoryboardSegmentsSchema = StoryboardSegmentsBaseSchema.superRefine(
  (segments, ctx) => {
    const seenIndices = new Set<number>();

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const expectedIndex = index + 1;

      if (segment.index !== expectedIndex || seenIndices.has(segment.index)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Storyboard segment indices must be unique and sequential starting at 1",
          path: [index, "index"],
        });
      }

      seenIndices.add(segment.index);
    }
  },
);

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

export async function getStoryboardWorkspaceData(projectId: string, userId: string) {
  const [project, scriptVersions] = await Promise.all([
    getProject(projectId, userId),
    listProjectScriptVersions(projectId, userId),
  ]);

  return {
    project,
    scriptVersions,
  };
}

export async function createStoryboardTask(input: {
  projectId: string;
  scriptVersionId: string;
  userId: string;
}) {
  const scriptVersion = await getOwnedScriptVersion(
    input.projectId,
    input.scriptVersionId,
    input.userId,
  );
  const lockKey = [
    "storyboard",
    input.projectId,
    scriptVersion.id,
    input.userId,
  ].join(":");

  const task = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${lockKey}),
        hashtext(${`${lockKey}:dedupe`})
      )
    `;

    const existingTask = await tx.task.findFirst({
      where: {
        projectId: input.projectId,
        createdById: input.userId,
        type: TaskType.STORYBOARD,
        inputJson: {
          equals: {
            projectId: input.projectId,
            scriptVersionId: scriptVersion.id,
            userId: input.userId,
          },
        },
        status: {
          notIn: [TaskStatus.FAILED, TaskStatus.CANCELED],
        },
      },
      select: {
        id: true,
      },
    });

    if (existingTask) {
      return {
        task: existingTask,
        isNew: false,
      };
    }

    const createdTask = await tx.task.create({
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

    return {
      task: createdTask,
      isNew: true,
    };
  });

  if (!task.isNew) {
    return {
      taskId: task.task.id,
    };
  }

  try {
    await enqueueTask(task.task.id, TaskType.STORYBOARD, {
      projectId: input.projectId,
      scriptVersionId: scriptVersion.id,
      userId: input.userId,
    });
  } catch (error) {
    await prisma.task.deleteMany({
      where: {
        id: task.task.id,
        projectId: input.projectId,
        createdById: input.userId,
        type: TaskType.STORYBOARD,
      },
    });

    throw error;
  }

  return {
    taskId: task.task.id,
  };
}
