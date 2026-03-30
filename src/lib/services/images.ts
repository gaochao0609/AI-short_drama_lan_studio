import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { Prisma, TaskType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { enqueueTask } from "@/lib/queues/enqueue";
import { getProject } from "@/lib/services/projects";
import { ServiceError } from "@/lib/services/errors";
import { getStorageRoot } from "@/lib/storage/paths";

function normalizePrompt(prompt: string) {
  return prompt.trim();
}

const ALLOWED_PREVIEW_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const INLINE_PREVIEW_MAX_BYTES = 64 * 1024;

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

export async function getImagesWorkspaceData(projectId: string, userId: string) {
  const project = await getProject(projectId, userId);
  const inlinePreviewCapBytes = Math.min(INLINE_PREVIEW_MAX_BYTES, getMaxUploadBytes());
  const storageRoot = getStorageRoot();

  const assets = await prisma.asset.findMany({
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
      kind: true,
      mimeType: true,
      sizeBytes: true,
      storagePath: true,
      createdAt: true,
      taskId: true,
    },
  });

  const summaries = await Promise.all(
    assets.map(async (asset) => {
      const base = {
        id: asset.id,
        kind: asset.kind,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        taskId: asset.taskId,
        createdAt: asset.createdAt.toISOString(),
      };

      if (
        !ALLOWED_PREVIEW_MIME_TYPES.has(asset.mimeType) ||
        asset.sizeBytes > inlinePreviewCapBytes
      ) {
        return {
          ...base,
          previewDataUrl: null as string | null,
        };
      }

      try {
        const filePath = path.isAbsolute(asset.storagePath)
          ? asset.storagePath
          : path.join(storageRoot, asset.storagePath);
        const fileStat = await stat(filePath);
        if (fileStat.size > inlinePreviewCapBytes) {
          return {
            ...base,
            previewDataUrl: null as string | null,
          };
        }
        const bytes = await readFile(filePath);

        if (bytes.length > inlinePreviewCapBytes) {
          return {
            ...base,
            previewDataUrl: null as string | null,
          };
        }

        return {
          ...base,
          previewDataUrl: `data:${asset.mimeType};base64,${bytes.toString("base64")}`,
        };
      } catch {
        return {
          ...base,
          previewDataUrl: null as string | null,
        };
      }
    }),
  );

  return {
    project: {
      id: project.id,
      title: project.title,
      idea: project.idea,
    },
    maxUploadMb: getMaxUploadMb(),
    assets: summaries,
  };
}

export async function enqueueImageGeneration(input: {
  projectId: string;
  prompt: string;
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

  const sourceAssetId = input.sourceAssetId?.trim() || undefined;

  if (sourceAssetId) {
    const sourceAsset = await prisma.asset.findFirst({
      where: {
        id: sourceAssetId,
        projectId: input.projectId,
        project: {
          ownerId: input.userId,
        },
      },
      select: {
        id: true,
      },
    });

    if (!sourceAsset) {
      throw new ServiceError(404, "Source asset not found");
    }
  }

  const task = await prisma.task.create({
    data: {
      projectId: input.projectId,
      createdById: input.userId,
      type: TaskType.IMAGE,
      inputJson: {
        projectId: input.projectId,
        userId: input.userId,
        prompt,
        mode: sourceAssetId ? "image_edit" : "image_generate",
        ...(sourceAssetId ? { sourceAssetId } : {}),
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
    ...(sourceAssetId ? { sourceAssetId } : {}),
  });

  return {
    taskId: task.id,
  };
}
