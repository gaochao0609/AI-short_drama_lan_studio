export const runtime = "nodejs";

import path from "node:path";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { ServiceError, toErrorResponse } from "@/lib/services/errors";
import { enqueueImageGeneration, getImagesWorkspaceData } from "@/lib/services/images";
import { getProject } from "@/lib/services/projects";
import { deleteFile, promoteTempFile, writeTempFile } from "@/lib/storage/fs-storage";
import { getStorageRoot, toStoredPath } from "@/lib/storage/paths";

const MULTIPART_OVERHEAD_BYTES = 256 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function getMaxUploadBytes() {
  const maxUploadMb = Number(process.env.MAX_UPLOAD_MB ?? "25");

  if (!Number.isFinite(maxUploadMb) || maxUploadMb <= 0) {
    return 25 * 1024 * 1024;
  }

  return Math.floor(maxUploadMb * 1024 * 1024);
}

function toPayloadTooLargeResponse(message = "Payload Too Large") {
  return Response.json(
    {
      error: message,
    },
    { status: 413 },
  );
}

function isMultipartRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.toLowerCase().includes("multipart/form-data");
}

function getFileExtension(mimeType: string) {
  if (mimeType === "image/png") {
    return "png";
  }

  if (mimeType === "image/jpeg") {
    return "jpg";
  }

  if (mimeType === "image/webp") {
    return "webp";
  }

  return "bin";
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId")?.trim() ?? "";

    if (!projectId) {
      throw new ServiceError(400, "projectId is required");
    }

    const payload = await getImagesWorkspaceData(projectId, user.userId);
    return Response.json(payload, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const maxBytes = getMaxUploadBytes();

    if (!isMultipartRequest(request)) {
      throw new ServiceError(400, "multipart/form-data is required");
    }

    const contentLengthHeader = request.headers.get("content-length");
    if (!contentLengthHeader) {
      return toPayloadTooLargeResponse("Payload too large (missing content-length)");
    }

    const parsedLength = Number(contentLengthHeader);
    if (!Number.isFinite(parsedLength) || parsedLength <= 0) {
      return toPayloadTooLargeResponse("Payload too large (invalid content-length)");
    }

    if (parsedLength > maxBytes + MULTIPART_OVERHEAD_BYTES) {
      return toPayloadTooLargeResponse("Payload too large");
    }

    const form = await request.formData();
    const projectId = String(form.get("projectId") ?? "").trim();
    const prompt = String(form.get("prompt") ?? "").trim();
    const sourceAssetId = String(form.get("sourceAssetId") ?? "").trim() || undefined;
    const sourceFile = form.get("sourceFile");

    if (!projectId) {
      throw new ServiceError(400, "projectId is required");
    }

    if (!prompt) {
      throw new ServiceError(400, "prompt is required");
    }

    await getProject(projectId, user.userId);

    if (sourceAssetId && sourceFile) {
      throw new ServiceError(400, "Provide either sourceAssetId or sourceFile, not both");
    }

    if (sourceFile && sourceFile instanceof File) {
      if (sourceFile.size > maxBytes) {
        return toPayloadTooLargeResponse("Payload too large");
      }

      if (!ALLOWED_IMAGE_MIME_TYPES.has(sourceFile.type)) {
        throw new ServiceError(409, "Unsupported source image type");
      }

      const bytes = Buffer.from(await sourceFile.arrayBuffer());
      if (bytes.length > maxBytes) {
        return toPayloadTooLargeResponse("Payload too large");
      }

      const storageRoot = getStorageRoot();
      const extension = getFileExtension(sourceFile.type);
      const destinationPath = path.join(
        storageRoot,
        "assets",
        projectId,
        "references",
        `${randomUUID()}.${extension}`,
      );

      let tempPath: string | null = null;
      let storedAssetId: string | null = null;

      try {
        tempPath = await writeTempFile(bytes);
        await promoteTempFile(tempPath, destinationPath);
        tempPath = null;

        const storedAsset = await prisma.asset.create({
          data: {
            projectId,
            taskId: null,
            kind: "image_reference",
            storagePath: toStoredPath(storageRoot, destinationPath),
            originalName: sourceFile.name || null,
            mimeType: sourceFile.type,
            sizeBytes: bytes.length,
            metadata: {
              role: "reference",
              uploadedBy: user.userId,
            } as Prisma.InputJsonValue,
          },
          select: {
            id: true,
          },
        });
        storedAssetId = storedAsset.id;

        const result = await enqueueImageGeneration({
          projectId,
          prompt,
          sourceAssetId: storedAsset.id,
          userId: user.userId,
        });

        return Response.json(result, { status: 202 });
      } catch (error) {
        // Best-effort cleanup. Never let cleanup errors mask the root failure.
        await Promise.allSettled([
          tempPath ? deleteFile(tempPath) : Promise.resolve(),
          storedAssetId
            ? prisma.asset.deleteMany({ where: { id: storedAssetId } })
            : Promise.resolve(),
          deleteFile(destinationPath),
        ]);

        throw error;
      }
    }

    const result = await enqueueImageGeneration({
      projectId,
      prompt,
      sourceAssetId,
      userId: user.userId,
    });

    return Response.json(result, { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
