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

const ALLOWED_PREVIEW_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const INLINE_PREVIEW_MAX_BYTES = 64 * 1024;

type ImageAssetSummary = {
  id: string;
  originalName: string | null;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  taskId: string | null;
  createdAt: string;
  previewDataUrl: string | null;
};

function getMaxUploadMb() {
  const maxUploadMb = Number(process.env.MAX_UPLOAD_MB ?? "25");

  if (!Number.isFinite(maxUploadMb) || maxUploadMb <= 0) {
    return 25;
  }

  return Math.floor(maxUploadMb);
}

function getMaxUploadBytes() {
  return getMaxUploadMb() * 1024 * 1024;
}

async function toImageAssetSummary(
  asset: {
    id: string;
    originalName: string | null;
    kind: string;
    mimeType: string;
    sizeBytes: number;
    storagePath: string;
    createdAt: Date;
    taskId: string | null;
  },
  input: {
    inlinePreviewCapBytes: number;
    storageRoot: string;
  },
): Promise<ImageAssetSummary> {
  const base = {
    id: asset.id,
    originalName: asset.originalName,
    kind: asset.kind,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    taskId: asset.taskId,
    createdAt: asset.createdAt.toISOString(),
  };

  if (
    !ALLOWED_PREVIEW_MIME_TYPES.has(asset.mimeType) ||
    asset.sizeBytes > input.inlinePreviewCapBytes
  ) {
    return {
      ...base,
      previewDataUrl: null,
    };
  }

  try {
    const filePath = resolveStoredPath(input.storageRoot, asset.storagePath);
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

export async function getImagesWorkspaceData(projectId: string, userId: string) {
  const [project, binding] = await Promise.all([
    getProject(projectId, userId),
    getProjectWorkflowBinding(projectId, userId),
  ]);
  const inlinePreviewCapBytes = Math.min(INLINE_PREVIEW_MAX_BYTES, getMaxUploadBytes());
  const storageRoot = getStorageRoot();

  const imageAssets = await prisma.asset.findMany({
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
  });

  const referenceAssets = await Promise.all(
    imageAssets.map((asset) =>
      toImageAssetSummary(asset, {
        inlinePreviewCapBytes,
        storageRoot,
      }),
    ),
  );
  const referenceAssetsById = new Map(referenceAssets.map((asset) => [asset.id, asset]));

  return {
    project: {
      id: project.id,
      title: project.title,
      idea: project.idea,
    },
    maxUploadMb: getMaxUploadMb(),
    binding: {
      imageReferenceAssetIds: binding.imageReferenceAssetIds,
    },
    defaultReferenceAssets: binding.imageReferenceAssetIds
      .map((assetId) => referenceAssetsById.get(assetId))
      .filter((asset): asset is ImageAssetSummary => Boolean(asset)),
    referenceAssets,
    assets: referenceAssets.filter((asset) => asset.kind === "image_generated"),
  };
}

export async function enqueueImageGeneration(input: {
  projectId: string;
  prompt: string;
  referenceAssetIds?: string[];
  sourceAssetId?: string;
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

  await getProject(input.projectId, input.userId);

  const referenceAssetIds = dedupeOrderedAssetIds([
    ...(input.referenceAssetIds ?? []),
    ...(input.sourceAssetId ? [input.sourceAssetId] : []),
  ]);

  if (referenceAssetIds.length > 0) {
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
  }

  const mode = referenceAssetIds.length > 0 ? "image_edit" : "image_generate";
  const task = await prisma.task.create({
    data: {
      projectId: input.projectId,
      createdById: input.userId,
      type: TaskType.IMAGE,
      inputJson: {
        projectId: input.projectId,
        userId: input.userId,
        prompt,
        mode,
        ...(referenceAssetIds.length > 0 ? { referenceAssetIds } : {}),
        ...(referenceAssetIds.length === 1 ? { sourceAssetId: referenceAssetIds[0] } : {}),
      } as Prisma.InputJsonValue,
    },
    select: {
      id: true,
    },
  });

  await enqueueTask(task.id, TaskType.IMAGE, {
    projectId: input.projectId,
    userId: input.userId,
    prompt,
    ...(referenceAssetIds.length > 0 ? { referenceAssetIds } : {}),
    ...(referenceAssetIds.length === 1 ? { sourceAssetId: referenceAssetIds[0] } : {}),
  });

  return {
    taskId: task.id,
  };
}
