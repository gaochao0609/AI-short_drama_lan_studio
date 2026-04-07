import { readFile, stat } from "node:fs/promises";
import { Prisma, TaskType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { enqueueTask } from "@/lib/queues/enqueue";
import { getProjectWorkflowBinding } from "@/lib/services/asset-bindings";
import { ServiceError } from "@/lib/services/errors";
import { getProject } from "@/lib/services/projects";
import { getStorageRoot, resolveStoredPath } from "@/lib/storage/paths";

function normalizePrompt(prompt: string) {
  return prompt.trim();
}

function dedupeOrderedAssetIds(assetIds: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const assetId of assetIds) {
    const normalized = assetId.trim();

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

const INLINE_IMAGE_PREVIEW_MAX_BYTES = 64 * 1024;
const PREVIEWABLE_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type AssetSummary = {
  id: string;
  originalName: string | null;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  taskId: string | null;
  createdAt: string;
  previewDataUrl: string | null;
  previewUrl?: string | null;
};

async function toAssetSummary(
  asset: {
    id: string;
    originalName: string | null;
    kind: string;
    mimeType: string;
    sizeBytes: number;
    storagePath: string;
    taskId: string | null;
    createdAt: Date;
  },
  input: {
    allowedMimeTypes: Set<string>;
    inlinePreviewCapBytes: number;
    previewUrl?: string;
    allowInlinePreview?: boolean;
  },
): Promise<AssetSummary> {
  const base = {
    id: asset.id,
    originalName: asset.originalName,
    kind: asset.kind,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    taskId: asset.taskId,
    createdAt: asset.createdAt.toISOString(),
    previewUrl: input.previewUrl ?? null,
  };

  if (input.allowInlinePreview === false) {
    return {
      ...base,
      previewDataUrl: null,
    };
  }

  if (
    !input.allowedMimeTypes.has(asset.mimeType) ||
    asset.sizeBytes > input.inlinePreviewCapBytes
  ) {
    return {
      ...base,
      previewDataUrl: null,
    };
  }

  try {
    const storageRoot = getStorageRoot();
    const filePath = resolveStoredPath(storageRoot, asset.storagePath);
    const fileStat = await stat(filePath);

    if (fileStat.size > input.inlinePreviewCapBytes) {
      return {
        ...base,
        previewDataUrl: null,
      };
    }

    const bytes = await readFile(filePath);
    if (bytes.length > input.inlinePreviewCapBytes) {
      return {
        ...base,
        previewDataUrl: null,
      };
    }

    return {
      ...base,
      previewDataUrl: `data:${asset.mimeType};base64,${bytes.toString("base64")}`,
    };
  } catch {
    return {
      ...base,
      previewDataUrl: null,
    };
  }
}

export async function getVideosWorkspaceData(projectId: string, userId: string) {
  const [project, binding] = await Promise.all([
    getProject(projectId, userId),
    getProjectWorkflowBinding(projectId, userId),
  ]);
  const boundReferenceAssetIds = dedupeOrderedAssetIds(binding.videoReferenceAssetIds);

  const [candidateReferenceAssets, boundReferenceAssets, videoAssets, tasks] = await Promise.all([
    prisma.asset.findMany({
      where: {
        projectId: project.id,
        mimeType: {
          startsWith: "image/",
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 50,
      select: {
        id: true,
        originalName: true,
        kind: true,
        mimeType: true,
        sizeBytes: true,
        storagePath: true,
        createdAt: true,
        taskId: true,
      },
    }),
    boundReferenceAssetIds.length > 0
      ? prisma.asset.findMany({
          where: {
            projectId: project.id,
            id: {
              in: boundReferenceAssetIds,
            },
          },
          select: {
            id: true,
            originalName: true,
            kind: true,
            mimeType: true,
            sizeBytes: true,
            storagePath: true,
            createdAt: true,
            taskId: true,
          },
        })
      : Promise.resolve([]),
    prisma.asset.findMany({
      where: {
        projectId: project.id,
        mimeType: {
          startsWith: "video/",
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 20,
      select: {
        id: true,
        originalName: true,
        kind: true,
        mimeType: true,
        sizeBytes: true,
        storagePath: true,
        createdAt: true,
        taskId: true,
      },
    }),
    prisma.task.findMany({
      where: {
        projectId: project.id,
        type: TaskType.VIDEO,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 10,
      select: {
        id: true,
        status: true,
        createdAt: true,
        errorText: true,
        outputJson: true,
      },
    }),
  ]);
  const boundReferenceAssetsById = new Map(boundReferenceAssets.map((asset) => [asset.id, asset]));
  const candidateReferenceAssetIds = new Set(candidateReferenceAssets.map((asset) => asset.id));
  const referenceAssets = [...candidateReferenceAssets];

  for (const assetId of boundReferenceAssetIds) {
    const asset = boundReferenceAssetsById.get(assetId);

    if (!asset || candidateReferenceAssetIds.has(asset.id)) {
      continue;
    }

    referenceAssets.push(asset);
  }

  const referenceSummaries = await Promise.all(
    referenceAssets.map((asset) =>
      toAssetSummary(asset, {
        allowedMimeTypes: PREVIEWABLE_IMAGE_MIME_TYPES,
        inlinePreviewCapBytes: INLINE_IMAGE_PREVIEW_MAX_BYTES,
      }),
    ),
  );
  const referenceAssetsById = new Map(referenceSummaries.map((asset) => [asset.id, asset]));

  return {
    project: {
      id: project.id,
      title: project.title,
      idea: project.idea,
    },
    binding: {
      videoReferenceAssetIds: boundReferenceAssetIds,
    },
    defaultReferenceAssets: boundReferenceAssetIds
      .map((assetId) => referenceAssetsById.get(assetId))
      .filter((asset): asset is AssetSummary => Boolean(asset)),
    referenceAssets: referenceSummaries,
    videoAssets: await Promise.all(
      videoAssets.map((asset) =>
        toAssetSummary(asset, {
          allowedMimeTypes: new Set<string>(),
          inlinePreviewCapBytes: 0,
          previewUrl: `/api/videos?projectId=${project.id}&assetId=${asset.id}`,
          allowInlinePreview: false,
        }),
      ),
    ),
    tasks: tasks.map((task) => ({
      id: task.id,
      status: task.status,
      createdAt: task.createdAt.toISOString(),
      errorText: task.errorText,
      outputJson: task.outputJson,
    })),
  };
}

export async function readOwnedVideoAsset(input: {
  projectId: string;
  assetId: string;
  userId: string;
}) {
  await getProject(input.projectId, input.userId);

  const asset = await prisma.asset.findFirst({
    where: {
      id: input.assetId,
      projectId: input.projectId,
      project: {
        ownerId: input.userId,
      },
      mimeType: {
        startsWith: "video/",
      },
    },
    select: {
      id: true,
      mimeType: true,
      sizeBytes: true,
      storagePath: true,
      originalName: true,
    },
  });

  if (!asset) {
    throw new ServiceError(404, "Video asset not found");
  }

  const storageRoot = getStorageRoot();
  const filePath = resolveStoredPath(storageRoot, asset.storagePath);

  return {
    ...asset,
    filePath,
  };
}

export async function enqueueVideoGeneration(input: {
  projectId: string;
  prompt: string;
  referenceAssetIds: string[];
  userId: string;
}): Promise<{ taskId: string }> {
  const prompt = normalizePrompt(input.prompt ?? "");

  if (!input.projectId?.trim()) {
    throw new ServiceError(400, "projectId is required");
  }

  if (!input.userId?.trim()) {
    throw new ServiceError(401, "Unauthorized");
  }

  if (!prompt) {
    throw new ServiceError(400, "prompt is required");
  }

  const referenceAssetIds = dedupeOrderedAssetIds(input.referenceAssetIds ?? []);

  if (referenceAssetIds.length === 0) {
    throw new ServiceError(400, "referenceAssetIds is required");
  }

  await getProject(input.projectId, input.userId);

  const referenceAssets = await prisma.asset.findMany({
    where: {
      id: {
        in: referenceAssetIds,
      },
      projectId: input.projectId,
      project: {
        ownerId: input.userId,
      },
    },
    select: {
      id: true,
      mimeType: true,
    },
  });

  if (referenceAssets.length !== referenceAssetIds.length) {
    throw new ServiceError(404, "One or more reference assets were not found");
  }

  if (referenceAssets.some((asset) => !asset.mimeType.startsWith("image/"))) {
    throw new ServiceError(409, "Reference assets must be images");
  }

  const task = await prisma.task.create({
    data: {
      projectId: input.projectId,
      createdById: input.userId,
      type: TaskType.VIDEO,
      inputJson: {
        projectId: input.projectId,
        userId: input.userId,
        prompt,
        referenceAssetIds,
      } as Prisma.InputJsonValue,
    },
    select: {
      id: true,
    },
  });

  await enqueueTask(task.id, TaskType.VIDEO, {
    projectId: input.projectId,
    userId: input.userId,
    prompt,
    referenceAssetIds,
  });

  return {
    taskId: task.id,
  };
}
