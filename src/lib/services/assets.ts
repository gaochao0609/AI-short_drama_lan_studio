import path from "node:path";
import { randomUUID } from "node:crypto";
import { AssetCategory, AssetOrigin, Prisma, TaskType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { enqueueTask } from "@/lib/queues/enqueue";
import { ServiceError } from "@/lib/services/errors";
import { getProject } from "@/lib/services/projects";
import { deleteFile, promoteTempFile, writeTempFile } from "@/lib/storage/fs-storage";
import { getStorageRoot, resolveStoredPath, toStoredPath } from "@/lib/storage/paths";

type ParseStatus = "pending" | "ready" | "failed" | null;

export type AssetSummary = {
  id: string;
  originalName: string | null;
  category: "script_source" | "script_generated" | "image_source" | "image_generated" | "video_generated";
  origin: "upload" | "system";
  mimeType: string;
  parseStatus: ParseStatus;
  parseError: string | null;
  createdAt: string;
  downloadUrl: string;
};

export type GroupedProjectAssets = {
  script_source: AssetSummary[];
  script_generated: AssetSummary[];
  image_source: AssetSummary[];
  image_generated: AssetSummary[];
  video_generated: AssetSummary[];
};

const ALLOWED_SCRIPT_EXTENSIONS = new Set([".txt", ".md"]);
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function createEmptyGroupedAssets(): GroupedProjectAssets {
  return {
    script_source: [],
    script_generated: [],
    image_source: [],
    image_generated: [],
    video_generated: [],
  };
}

function toDownloadUrl(assetId: string) {
  return `/api/assets/${assetId}/download`;
}

function readMetadataObject(metadata: Prisma.JsonValue | null) {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return { ...(metadata as Record<string, unknown>) };
  }

  return {};
}

function toCategoryToken(input: {
  category: AssetCategory | null;
  mimeType: string;
  taskId: string | null;
}) {
  if (input.category === AssetCategory.SCRIPT_SOURCE) {
    return "script_source" as const;
  }

  if (input.category === AssetCategory.SCRIPT_GENERATED) {
    return "script_generated" as const;
  }

  if (input.category === AssetCategory.IMAGE_SOURCE) {
    return "image_source" as const;
  }

  if (input.category === AssetCategory.IMAGE_GENERATED) {
    return "image_generated" as const;
  }

  if (input.category === AssetCategory.VIDEO_GENERATED) {
    return "video_generated" as const;
  }

  if (input.mimeType.startsWith("image/")) {
    return input.taskId ? ("image_generated" as const) : ("image_source" as const);
  }

  if (input.mimeType.startsWith("video/")) {
    return "video_generated" as const;
  }

  if (input.mimeType.startsWith("text/")) {
    return "script_source" as const;
  }

  return null;
}

function toOriginToken(input: {
  origin: AssetOrigin | null;
  category: keyof GroupedProjectAssets;
}): "upload" | "system" {
  if (input.origin === AssetOrigin.UPLOAD) {
    return "upload";
  }

  if (input.origin === AssetOrigin.SYSTEM) {
    return "system";
  }

  if (
    input.category === "script_generated" ||
    input.category === "image_generated" ||
    input.category === "video_generated"
  ) {
    return "system";
  }

  return "upload";
}

function readParseStatus(metadata: Prisma.JsonValue | null): ParseStatus {
  const value = readMetadataObject(metadata).parseStatus;

  if (value === "pending" || value === "ready" || value === "failed") {
    return value;
  }

  return null;
}

function readParseError(metadata: Prisma.JsonValue | null) {
  const value = readMetadataObject(metadata).parseError;

  if (typeof value === "string" && value.trim()) {
    return value;
  }

  return null;
}

function normalizeImageExtension(mimeType: string) {
  if (mimeType === "image/png") {
    return ".png";
  }

  if (mimeType === "image/jpeg") {
    return ".jpg";
  }

  if (mimeType === "image/webp") {
    return ".webp";
  }

  return ".bin";
}

function getScriptUploadDetails(file: File) {
  const extension = path.extname(file.name).toLowerCase();

  if (!ALLOWED_SCRIPT_EXTENSIONS.has(extension)) {
    return null;
  }

  const mimeType = file.type?.trim() || (extension === ".md" ? "text/markdown" : "text/plain");

  return {
    extension,
    mimeType,
  };
}

function toScriptPendingMetadata(input: {
  fileName: string;
  extension: string;
  previousMetadata?: Prisma.JsonValue | null;
}) {
  const metadata = readMetadataObject(input.previousMetadata ?? null);

  delete metadata.parseError;
  delete metadata.parseErrorText;
  metadata.originalFileName = input.fileName;
  metadata.extension = input.extension;
  metadata.parseStatus = "pending";

  return metadata as Prisma.InputJsonValue;
}

function toScriptFailedMetadata(input: {
  fileName: string;
  extension: string;
  errorText: string;
  previousMetadata?: Prisma.JsonValue | null;
}) {
  const metadata = readMetadataObject(input.previousMetadata ?? null);

  metadata.originalFileName = input.fileName;
  metadata.extension = input.extension;
  metadata.parseStatus = "failed";
  metadata.parseError = input.errorText;

  return metadata as Prisma.InputJsonValue;
}

async function getOwnedProjectAsset(input: {
  projectId: string;
  assetId: string;
  userId: string;
}) {
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
      projectId: true,
      category: true,
      origin: true,
      mimeType: true,
      storagePath: true,
      originalName: true,
      metadata: true,
    },
  });

  if (!asset) {
    throw new ServiceError(404, "Asset not found");
  }

  return asset;
}

export async function listProjectAssets(projectId: string, userId: string) {
  const project = await getProject(projectId, userId);
  const groupedAssets = createEmptyGroupedAssets();

  const assets = await prisma.asset.findMany({
    where: {
      projectId: project.id,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      taskId: true,
      category: true,
      origin: true,
      mimeType: true,
      originalName: true,
      metadata: true,
      createdAt: true,
    },
  });

  for (const asset of assets) {
    const category = toCategoryToken({
      category: asset.category,
      mimeType: asset.mimeType,
      taskId: asset.taskId,
    });

    if (!category) {
      continue;
    }

    groupedAssets[category].push({
      id: asset.id,
      originalName: asset.originalName,
      category,
      origin: toOriginToken({
        origin: asset.origin,
        category,
      }),
      mimeType: asset.mimeType,
      parseStatus: readParseStatus(asset.metadata),
      parseError: readParseError(asset.metadata),
      createdAt: asset.createdAt.toISOString(),
      downloadUrl: toDownloadUrl(asset.id),
    });
  }

  return {
    project: {
      id: project.id,
      title: project.title,
    },
    assets: groupedAssets,
  };
}

export async function uploadProjectAsset(input: {
  projectId: string;
  userId: string;
  file: File;
}) {
  const project = await getProject(input.projectId, input.userId);
  const file = input.file;
  const bytes = Buffer.from(await file.arrayBuffer());

  if (bytes.length === 0) {
    throw new ServiceError(400, "file is required");
  }

  const scriptUpload = getScriptUploadDetails(file);
  const storageRoot = getStorageRoot();

  if (scriptUpload) {
    const destinationPath = path.join(
      storageRoot,
      "assets",
      project.id,
      "uploads",
      "scripts",
      `${randomUUID()}${scriptUpload.extension}`,
    );

    const tempPath = await writeTempFile(bytes);

    try {
      await promoteTempFile(tempPath, destinationPath);
    } catch (error) {
      await deleteFile(tempPath);
      throw error;
    }

    const fileName = file.name || path.basename(destinationPath);
    const pendingMetadata = toScriptPendingMetadata({
      fileName,
      extension: scriptUpload.extension,
    });

    const createdAsset = await prisma.asset.create({
      data: {
        projectId: project.id,
        kind: "script_source",
        category: AssetCategory.SCRIPT_SOURCE,
        origin: AssetOrigin.UPLOAD,
        storagePath: toStoredPath(storageRoot, destinationPath),
        originalName: file.name || null,
        mimeType: scriptUpload.mimeType,
        sizeBytes: bytes.length,
        metadata: pendingMetadata,
      },
      select: {
        id: true,
      },
    });

    try {
      const payload = {
        projectId: project.id,
        userId: input.userId,
        assetId: createdAsset.id,
      };
      const task = await prisma.task.create({
        data: {
          projectId: project.id,
          createdById: input.userId,
          type: TaskType.ASSET_SCRIPT_PARSE,
          inputJson: payload,
        },
        select: {
          id: true,
        },
      });

      await enqueueTask(task.id, TaskType.ASSET_SCRIPT_PARSE, payload);

      return {
        assetId: createdAsset.id,
        taskId: task.id,
      };
    } catch (error) {
      const errorText =
        error instanceof Error ? error.message : "Failed to enqueue script parse task";

      await prisma.asset
        .update({
          where: {
            id: createdAsset.id,
          },
          data: {
            metadata: toScriptFailedMetadata({
              fileName,
              extension: scriptUpload.extension,
              errorText,
              previousMetadata: pendingMetadata as unknown as Prisma.JsonValue,
            }),
          },
        })
        .catch(() => undefined);

      throw error;
    }
  }

  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
    throw new ServiceError(409, "Unsupported upload file type");
  }

  const imageExtension = normalizeImageExtension(file.type);
  const destinationPath = path.join(
    storageRoot,
    "assets",
    project.id,
    "uploads",
    "images",
    `${randomUUID()}${imageExtension}`,
  );
  const tempPath = await writeTempFile(bytes);

  try {
    await promoteTempFile(tempPath, destinationPath);
  } catch (error) {
    await deleteFile(tempPath);
    throw error;
  }

  const createdAsset = await prisma.asset.create({
    data: {
      projectId: project.id,
      kind: "image_source",
      category: AssetCategory.IMAGE_SOURCE,
      origin: AssetOrigin.UPLOAD,
      storagePath: toStoredPath(storageRoot, destinationPath),
      originalName: file.name || null,
      mimeType: file.type,
      sizeBytes: bytes.length,
      metadata: {
        uploadedBy: input.userId,
      },
    },
    select: {
      id: true,
    },
  });

  return {
    assetId: createdAsset.id,
  };
}

export async function retryScriptSourceParse(input: {
  projectId: string;
  assetId: string;
  userId: string;
}) {
  await getProject(input.projectId, input.userId);

  const asset = await getOwnedProjectAsset({
    projectId: input.projectId,
    assetId: input.assetId,
    userId: input.userId,
  });

  if (asset.category !== AssetCategory.SCRIPT_SOURCE) {
    throw new ServiceError(409, "Only script_source assets can be retried");
  }

  if (readParseStatus(asset.metadata) !== "failed") {
    throw new ServiceError(409, "Only failed script_source assets can be retried");
  }

  const fileName = asset.originalName ?? (path.basename(asset.storagePath) || asset.id);
  const extension = path.extname(asset.storagePath) || ".txt";
  const pendingMetadata = toScriptPendingMetadata({
    fileName,
    extension,
    previousMetadata: asset.metadata,
  });

  await prisma.asset.update({
    where: {
      id: asset.id,
    },
    data: {
      metadata: pendingMetadata,
    },
  });

  try {
    const payload = {
      projectId: input.projectId,
      userId: input.userId,
      assetId: asset.id,
    };
    const task = await prisma.task.create({
      data: {
        projectId: input.projectId,
        createdById: input.userId,
        type: TaskType.ASSET_SCRIPT_PARSE,
        inputJson: payload,
      },
      select: {
        id: true,
      },
    });

    await enqueueTask(task.id, TaskType.ASSET_SCRIPT_PARSE, payload);

    return {
      assetId: asset.id,
      taskId: task.id,
    };
  } catch (error) {
    const errorText =
      error instanceof Error ? error.message : "Failed to enqueue script parse task";

    await prisma.asset
      .update({
        where: {
          id: asset.id,
        },
        data: {
          metadata: toScriptFailedMetadata({
            fileName,
            extension,
            errorText,
            previousMetadata: pendingMetadata as unknown as Prisma.JsonValue,
          }),
        },
      })
      .catch(() => undefined);

    throw error;
  }
}

export async function deleteProjectAsset(input: {
  projectId: string;
  assetId: string;
  userId: string;
}) {
  await getProject(input.projectId, input.userId);

  const asset = await getOwnedProjectAsset({
    projectId: input.projectId,
    assetId: input.assetId,
    userId: input.userId,
  });

  const binding = await prisma.projectWorkflowBinding.findUnique({
    where: {
      projectId: input.projectId,
    },
    select: {
      storyboardScriptAssetId: true,
      imageReferenceAssetIds: true,
      videoReferenceAssetIds: true,
    },
  });

  const isBound =
    binding?.storyboardScriptAssetId === asset.id ||
    (binding?.imageReferenceAssetIds ?? []).includes(asset.id) ||
    (binding?.videoReferenceAssetIds ?? []).includes(asset.id);

  if (isBound) {
    throw new ServiceError(409, "Asset is currently bound and cannot be deleted");
  }

  const provenanceReferenceCount = await prisma.assetSourceLink.count({
    where: {
      OR: [
        {
          assetId: asset.id,
        },
        {
          sourceAssetId: asset.id,
        },
      ],
    },
  });

  if (provenanceReferenceCount > 0) {
    throw new ServiceError(409, "Asset has provenance references and cannot be deleted");
  }

  await prisma.asset.delete({
    where: {
      id: asset.id,
    },
  });

  const storageRoot = getStorageRoot();
  const filePath = resolveStoredPath(storageRoot, asset.storagePath);

  await deleteFile(filePath).catch(() => undefined);

  return {
    id: asset.id,
  };
}
