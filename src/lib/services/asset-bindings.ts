import { AssetCategory, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/services/errors";
import { getProject } from "@/lib/services/projects";

const MAX_REFERENCE_ASSETS = 8;

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

export type ProjectWorkflowBindingSummary = {
  storyboardScriptAssetId: string | null;
  imageReferenceAssetIds: string[];
  videoReferenceAssetIds: string[];
};

export async function getProjectWorkflowBinding(projectId: string, userId: string) {
  await getProject(projectId, userId);

  const binding = await prisma.projectWorkflowBinding.findUnique({
    where: {
      projectId,
    },
    select: {
      storyboardScriptAssetId: true,
      imageReferenceAssetIds: true,
      videoReferenceAssetIds: true,
    },
  });

  if (!binding) {
    return {
      storyboardScriptAssetId: null,
      imageReferenceAssetIds: [],
      videoReferenceAssetIds: [],
    } satisfies ProjectWorkflowBindingSummary;
  }

  return {
    storyboardScriptAssetId: binding.storyboardScriptAssetId,
    imageReferenceAssetIds: binding.imageReferenceAssetIds,
    videoReferenceAssetIds: binding.videoReferenceAssetIds,
  } satisfies ProjectWorkflowBindingSummary;
}

async function validateStoryboardScriptAsset(input: {
  projectId: string;
  userId: string;
  assetId: string;
}) {
  const scriptAsset = await prisma.asset.findFirst({
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
      metadata: true,
    },
  });

  if (!scriptAsset) {
    throw new ServiceError(404, "Storyboard script asset not found");
  }

  if (
    scriptAsset.category !== AssetCategory.SCRIPT_SOURCE &&
    scriptAsset.category !== AssetCategory.SCRIPT_GENERATED
  ) {
    throw new ServiceError(409, "Storyboard script asset must be a script asset");
  }

  if (
    scriptAsset.category === AssetCategory.SCRIPT_SOURCE &&
    readParseStatus(scriptAsset.metadata) !== "ready"
  ) {
    throw new ServiceError(409, "Storyboard script asset must be parse-ready");
  }
}

async function validateImageReferenceAssets(input: {
  projectId: string;
  userId: string;
  assetIds: string[];
}) {
  if (input.assetIds.length > MAX_REFERENCE_ASSETS) {
    throw new ServiceError(409, `Reference assets cannot exceed ${MAX_REFERENCE_ASSETS}`);
  }

  if (input.assetIds.length === 0) {
    return;
  }

  const assets = await prisma.asset.findMany({
    where: {
      id: {
        in: input.assetIds,
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

  if (assets.length !== input.assetIds.length) {
    throw new ServiceError(404, "One or more reference assets were not found");
  }

  if (assets.some((asset) => !asset.mimeType.startsWith("image/"))) {
    throw new ServiceError(409, "Reference assets must be images");
  }
}

export async function patchProjectWorkflowBinding(input: {
  projectId: string;
  userId: string;
  storyboardScriptAssetId?: string | null;
  imageReferenceAssetIds?: string[];
  videoReferenceAssetIds?: string[];
}) {
  await getProject(input.projectId, input.userId);

  const existingBinding = await prisma.projectWorkflowBinding.findUnique({
    where: {
      projectId: input.projectId,
    },
    select: {
      storyboardScriptAssetId: true,
      imageReferenceAssetIds: true,
      videoReferenceAssetIds: true,
    },
  });

  let storyboardScriptAssetId = existingBinding?.storyboardScriptAssetId ?? null;
  let imageReferenceAssetIds = existingBinding?.imageReferenceAssetIds ?? [];
  let videoReferenceAssetIds = existingBinding?.videoReferenceAssetIds ?? [];

  if (input.storyboardScriptAssetId !== undefined) {
    if (input.storyboardScriptAssetId === null) {
      storyboardScriptAssetId = null;
    } else {
      await validateStoryboardScriptAsset({
        projectId: input.projectId,
        userId: input.userId,
        assetId: input.storyboardScriptAssetId,
      });
      storyboardScriptAssetId = input.storyboardScriptAssetId;
    }
  }

  if (input.imageReferenceAssetIds !== undefined) {
    const dedupedImageAssetIds = dedupeOrderedAssetIds(input.imageReferenceAssetIds);
    await validateImageReferenceAssets({
      projectId: input.projectId,
      userId: input.userId,
      assetIds: dedupedImageAssetIds,
    });
    imageReferenceAssetIds = dedupedImageAssetIds;
  }

  if (input.videoReferenceAssetIds !== undefined) {
    const dedupedVideoAssetIds = dedupeOrderedAssetIds(input.videoReferenceAssetIds);
    await validateImageReferenceAssets({
      projectId: input.projectId,
      userId: input.userId,
      assetIds: dedupedVideoAssetIds,
    });
    videoReferenceAssetIds = dedupedVideoAssetIds;
  }

  const binding = await prisma.projectWorkflowBinding.upsert({
    where: {
      projectId: input.projectId,
    },
    create: {
      projectId: input.projectId,
      storyboardScriptAssetId,
      imageReferenceAssetIds,
      videoReferenceAssetIds,
    },
    update: {
      storyboardScriptAssetId,
      imageReferenceAssetIds,
      videoReferenceAssetIds,
    },
    select: {
      storyboardScriptAssetId: true,
      imageReferenceAssetIds: true,
      videoReferenceAssetIds: true,
    },
  });

  return {
    storyboardScriptAssetId: binding.storyboardScriptAssetId,
    imageReferenceAssetIds: binding.imageReferenceAssetIds,
    videoReferenceAssetIds: binding.videoReferenceAssetIds,
  } satisfies ProjectWorkflowBindingSummary;
}
