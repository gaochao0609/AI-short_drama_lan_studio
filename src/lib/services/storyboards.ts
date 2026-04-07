import { AssetCategory, Prisma, TaskStatus, TaskType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { enqueueTask } from "@/lib/queues/enqueue";
import { ServiceError } from "@/lib/services/errors";
import { getProject } from "@/lib/services/projects";

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

export type StoryboardScriptAssetSummary = {
  id: string;
  originalName: string;
  category: "script_source" | "script_generated";
  origin: "upload" | "system";
  createdAt: string;
  extractedText: string;
  scriptVersionId: string | null;
};

export type ResolvedStoryboardScriptInput = {
  scriptAssetId: string | null;
  scriptVersionId: string | null;
  scriptBody: string;
};

type StoryboardTaskPayload = {
  projectId: string;
  scriptAssetId?: string;
  scriptVersionId?: string;
  userId: string;
};

function readMetadataObject(metadata: Prisma.JsonValue | null) {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }

  return {};
}

function readParseStatus(metadata: Prisma.JsonValue | null) {
  const value = readMetadataObject(metadata).parseStatus;

  if (value === "pending" || value === "ready" || value === "failed") {
    return value;
  }

  return null;
}

function readExtractedText(metadata: Prisma.JsonValue | null) {
  const value = readMetadataObject(metadata).extractedText;

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return null;
}

function readScriptVersionId(metadata: Prisma.JsonValue | null) {
  const value = readMetadataObject(metadata).scriptVersionId;

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return null;
}

function toScriptAssetCategory(category: AssetCategory) {
  return category === AssetCategory.SCRIPT_SOURCE
    ? ("script_source" as const)
    : ("script_generated" as const);
}

function toScriptAssetOrigin(category: AssetCategory) {
  return category === AssetCategory.SCRIPT_SOURCE
    ? ("upload" as const)
    : ("system" as const);
}

function toStoryboardTaskPayload(input: {
  projectId: string;
  userId: string;
  scriptAssetId: string | null;
  scriptVersionId: string | null;
}) {
  const payload: StoryboardTaskPayload = {
    projectId: input.projectId,
    userId: input.userId,
  };

  if (input.scriptAssetId) {
    payload.scriptAssetId = input.scriptAssetId;
  }

  if (input.scriptVersionId) {
    payload.scriptVersionId = input.scriptVersionId;
  }

  return payload;
}

function isStoryboardScriptCategory(
  category: AssetCategory | null,
): category is AssetCategory {
  return (
    category === AssetCategory.SCRIPT_SOURCE ||
    category === AssetCategory.SCRIPT_GENERATED
  );
}

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

async function resolveStoryboardScriptBodyFromAssetRecord(input: {
  projectId: string;
  assetId: string;
  category: AssetCategory;
  metadata: Prisma.JsonValue | null;
}) {
  const parseStatus = readParseStatus(input.metadata);

  if (parseStatus === "pending") {
    throw new ServiceError(409, "Storyboard script asset is still pending parse");
  }

  if (parseStatus === "failed") {
    throw new ServiceError(409, "Storyboard script asset failed to parse");
  }

  if (
    input.category === AssetCategory.SCRIPT_SOURCE &&
    parseStatus !== "ready"
  ) {
    throw new ServiceError(409, "Storyboard script asset is not ready");
  }

  const scriptVersionId = readScriptVersionId(input.metadata);
  const extractedText = readExtractedText(input.metadata);

  if (extractedText) {
    return {
      scriptBody: extractedText,
      scriptVersionId,
    };
  }

  if (!scriptVersionId) {
    throw new ServiceError(409, "Storyboard script asset is missing extracted text");
  }

  const scriptVersion = await prisma.scriptVersion.findFirst({
    where: {
      id: scriptVersionId,
      projectId: input.projectId,
    },
    select: {
      id: true,
      body: true,
    },
  });

  if (typeof scriptVersion?.body !== "string" || !scriptVersion.body.trim()) {
    throw new ServiceError(409, "Storyboard script asset is missing extracted text");
  }

  return {
    scriptBody: scriptVersion.body.trim(),
    scriptVersionId: scriptVersion.id,
  };
}

async function getOwnedStoryboardScriptAsset(input: {
  projectId: string;
  assetId: string;
  userId: string;
}): Promise<{
  id: string;
  category: AssetCategory;
  originalName: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
}> {
  const asset = await prisma.asset.findFirst({
    where: {
      id: input.assetId,
      projectId: input.projectId,
      project: {
        ownerId: input.userId,
      },
    },
    select: {
      id: true,
      category: true,
      originalName: true,
      metadata: true,
      createdAt: true,
    },
  });

  if (!asset) {
    throw new ServiceError(404, "Storyboard script asset not found");
  }

  if (!isStoryboardScriptCategory(asset.category)) {
    throw new ServiceError(409, "Storyboard script asset must be a script asset");
  }

  return {
    ...asset,
    category: asset.category,
  };
}

async function resolveStoryboardScriptAsset(input: {
  projectId: string;
  assetId: string;
  userId: string;
}) {
  const asset = await getOwnedStoryboardScriptAsset(input);
  const resolved = await resolveStoryboardScriptBodyFromAssetRecord({
    projectId: input.projectId,
    assetId: asset.id,
    category: asset.category,
    metadata: asset.metadata,
  });

  return {
    scriptAssetId: asset.id,
    scriptVersionId: resolved.scriptVersionId,
    scriptBody: resolved.scriptBody,
  } satisfies ResolvedStoryboardScriptInput;
}

async function resolveLegacyStoryboardScriptVersion(input: {
  projectId: string;
  scriptVersionId: string;
  userId: string;
}) {
  const scriptVersion = await getOwnedScriptVersion(
    input.projectId,
    input.scriptVersionId,
    input.userId,
  );
  const linkedAsset = await prisma.asset.findFirst({
    where: {
      projectId: input.projectId,
      category: AssetCategory.SCRIPT_GENERATED,
      metadata: {
        path: ["scriptVersionId"],
        equals: scriptVersion.id,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      category: true,
      metadata: true,
    },
  });

  if (!linkedAsset) {
    return {
      scriptAssetId: null,
      scriptVersionId: scriptVersion.id,
      scriptBody: scriptVersion.body,
    } satisfies ResolvedStoryboardScriptInput;
  }

  if (!isStoryboardScriptCategory(linkedAsset.category)) {
    return {
      scriptAssetId: null,
      scriptVersionId: scriptVersion.id,
      scriptBody: scriptVersion.body,
    } satisfies ResolvedStoryboardScriptInput;
  }

  const resolved = await resolveStoryboardScriptBodyFromAssetRecord({
    projectId: input.projectId,
    assetId: linkedAsset.id,
    category: linkedAsset.category,
    metadata: linkedAsset.metadata,
  });

  return {
    scriptAssetId: linkedAsset.id,
    scriptVersionId: resolved.scriptVersionId ?? scriptVersion.id,
    scriptBody: resolved.scriptBody,
  } satisfies ResolvedStoryboardScriptInput;
}

async function listStoryboardScriptAssets(projectId: string) {
  const assets = await prisma.asset.findMany({
    where: {
      projectId,
      category: {
        in: [AssetCategory.SCRIPT_SOURCE, AssetCategory.SCRIPT_GENERATED],
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
      category: true,
      originalName: true,
      metadata: true,
      createdAt: true,
    },
  });

  const scriptVersionIds = Array.from(
    new Set(
      assets
        .map((asset) => readScriptVersionId(asset.metadata))
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const scriptVersions = scriptVersionIds.length
    ? await prisma.scriptVersion.findMany({
        where: {
          projectId,
          id: {
            in: scriptVersionIds,
          },
        },
        select: {
          id: true,
          body: true,
        },
      })
    : [];
  const scriptVersionBodyMap = new Map(
    scriptVersions.map((scriptVersion) => [scriptVersion.id, scriptVersion.body]),
  );

  return assets.flatMap((asset) => {
    const parseStatus = readParseStatus(asset.metadata);

    if (parseStatus === "pending" || parseStatus === "failed") {
      return [];
    }

    const scriptVersionId = readScriptVersionId(asset.metadata);
    const fallbackBody = scriptVersionId
      ? scriptVersionBodyMap.get(scriptVersionId) ?? null
      : null;
    const extractedText = readExtractedText(asset.metadata) ?? fallbackBody?.trim() ?? null;

    if (!extractedText || !isStoryboardScriptCategory(asset.category)) {
      return [];
    }

    return [
      {
        id: asset.id,
        originalName: asset.originalName?.trim() || asset.id,
        category: toScriptAssetCategory(asset.category),
        origin: toScriptAssetOrigin(asset.category),
        createdAt: asset.createdAt.toISOString(),
        extractedText,
        scriptVersionId,
      } satisfies StoryboardScriptAssetSummary,
    ];
  });
}

export async function resolveStoryboardScriptInput(input: {
  projectId: string;
  userId: string;
  scriptAssetId?: string;
  scriptVersionId?: string;
}) {
  if (input.scriptAssetId) {
    return resolveStoryboardScriptAsset({
      projectId: input.projectId,
      assetId: input.scriptAssetId,
      userId: input.userId,
    });
  }

  if (input.scriptVersionId) {
    return resolveLegacyStoryboardScriptVersion({
      projectId: input.projectId,
      scriptVersionId: input.scriptVersionId,
      userId: input.userId,
    });
  }

  throw new ServiceError(400, "scriptAssetId or scriptVersionId is required");
}

export async function getStoryboardWorkspaceData(projectId: string, userId: string) {
  const [project, scriptAssets, binding] = await Promise.all([
    getProject(projectId, userId),
    listStoryboardScriptAssets(projectId),
    prisma.projectWorkflowBinding.findUnique({
      where: {
        projectId,
      },
      select: {
        storyboardScriptAssetId: true,
      },
    }),
  ]);
  const defaultScriptAsset =
    scriptAssets.find((asset) => asset.id === binding?.storyboardScriptAssetId) ?? null;

  return {
    project: {
      id: project.id,
      title: project.title,
      idea: project.idea,
    },
    binding: {
      storyboardScriptAssetId: binding?.storyboardScriptAssetId ?? null,
    },
    defaultScriptAsset,
    scriptAssets,
  };
}

export async function createStoryboardTask(input: {
  projectId: string;
  userId: string;
  scriptAssetId?: string;
  scriptVersionId?: string;
}) {
  const resolvedScriptInput = await resolveStoryboardScriptInput({
    projectId: input.projectId,
    userId: input.userId,
    scriptAssetId: input.scriptAssetId,
    scriptVersionId: input.scriptVersionId,
  });
  const payload = toStoryboardTaskPayload({
    projectId: input.projectId,
    userId: input.userId,
    scriptAssetId: resolvedScriptInput.scriptAssetId,
    scriptVersionId: resolvedScriptInput.scriptVersionId,
  });
  const lockKey = [
    "storyboard",
    input.projectId,
    resolvedScriptInput.scriptAssetId ?? resolvedScriptInput.scriptVersionId ?? "unknown",
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
          equals: payload as Prisma.InputJsonValue,
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
        inputJson: payload as Prisma.InputJsonValue,
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
    await enqueueTask(task.task.id, TaskType.STORYBOARD, payload);
  } catch (error) {
    const errorText =
      error instanceof Error ? error.message : "Failed to enqueue storyboard task";

    await prisma.$transaction(async (tx) => {
      await tx.task.updateMany({
        where: {
          id: task.task.id,
          status: TaskStatus.QUEUED,
        },
        data: {
          status: TaskStatus.FAILED,
          finishedAt: new Date(),
          errorText,
        },
      });

      const latestTaskStep = await tx.taskStep.findFirst({
        where: {
          taskId: task.task.id,
        },
        orderBy: {
          createdAt: "desc",
        },
        select: {
          id: true,
          status: true,
        },
      });

      if (latestTaskStep?.status === TaskStatus.QUEUED) {
        await tx.taskStep.updateMany({
          where: {
            id: latestTaskStep.id,
            status: TaskStatus.QUEUED,
          },
          data: {
            status: TaskStatus.FAILED,
            errorText,
          },
        });
      }
    });

    throw error;
  }

  return {
    taskId: task.task.id,
  };
}
