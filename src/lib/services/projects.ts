import { readFile, stat } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/services/errors";
import { listProjectTaskHistory } from "@/lib/services/tasks";
import { getStorageRoot, resolveStoredPath } from "@/lib/storage/paths";

const INLINE_IMAGE_PREVIEW_MAX_BYTES = 64 * 1024;
const PREVIEWABLE_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

async function toInlineImagePreview(storagePath: string, mimeType: string, sizeBytes: number) {
  if (!PREVIEWABLE_IMAGE_MIME_TYPES.has(mimeType) || sizeBytes > INLINE_IMAGE_PREVIEW_MAX_BYTES) {
    return null;
  }

  try {
    const storageRoot = getStorageRoot();
    const filePath = resolveStoredPath(storageRoot, storagePath);
    const fileStat = await stat(filePath);

    if (fileStat.size > INLINE_IMAGE_PREVIEW_MAX_BYTES) {
      return null;
    }

    const bytes = await readFile(filePath);
    if (bytes.length > INLINE_IMAGE_PREVIEW_MAX_BYTES) {
      return null;
    }

    return `data:${mimeType};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

function toDownloadUrl(assetId: string) {
  return `/api/assets/${assetId}/download`;
}

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

export async function getProjectDetail(projectId: string, ownerId: string) {
  const project = await getProject(projectId, ownerId);

  const [scriptVersions, storyboardVersions, assets, taskHistory] = await Promise.all([
    prisma.scriptVersion.findMany({
      where: {
        projectId: project.id,
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
    }),
    prisma.storyboardVersion.findMany({
      where: {
        projectId: project.id,
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        scriptVersionId: true,
        taskId: true,
        framesJson: true,
        createdAt: true,
      },
    }),
    prisma.asset.findMany({
      where: {
        projectId: project.id,
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        kind: true,
        mimeType: true,
        sizeBytes: true,
        storagePath: true,
        originalName: true,
        taskId: true,
        createdAt: true,
      },
    }),
    listProjectTaskHistory(project.id, ownerId),
  ]);

  const imageAssets = assets.filter((asset) => asset.mimeType.startsWith("image/"));
  const videoAssets = assets.filter((asset) => asset.mimeType.startsWith("video/"));

  return {
    ...project,
    scriptVersions,
    storyboardVersions: storyboardVersions.map((version) => ({
      id: version.id,
      scriptVersionId: version.scriptVersionId,
      taskId: version.taskId,
      frameCount: Array.isArray(version.framesJson) ? version.framesJson.length : 0,
      createdAt: version.createdAt,
    })),
    imageAssets: await Promise.all(
      imageAssets.map(async (asset) => ({
        id: asset.id,
        kind: asset.kind,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        originalName: asset.originalName,
        taskId: asset.taskId,
        createdAt: asset.createdAt,
        downloadUrl: toDownloadUrl(asset.id),
        previewDataUrl: await toInlineImagePreview(asset.storagePath, asset.mimeType, asset.sizeBytes),
      })),
    ),
    videoAssets: videoAssets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      originalName: asset.originalName,
      taskId: asset.taskId,
      createdAt: asset.createdAt,
      downloadUrl: toDownloadUrl(asset.id),
      previewUrl: toDownloadUrl(asset.id),
    })),
    taskHistory,
  };
}

export async function readOwnedProjectAsset(assetId: string, ownerId: string) {
  const asset = await prisma.asset.findFirst({
    where: {
      id: assetId,
      project: {
        ownerId,
      },
    },
    select: {
      id: true,
      projectId: true,
      kind: true,
      storagePath: true,
      originalName: true,
      mimeType: true,
      sizeBytes: true,
    },
  });

  if (!asset) {
    throw new ServiceError(404, "Asset not found");
  }

  const storageRoot = getStorageRoot();
  const filePath = resolveStoredPath(storageRoot, asset.storagePath);

  return {
    ...asset,
    filePath,
  };
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
