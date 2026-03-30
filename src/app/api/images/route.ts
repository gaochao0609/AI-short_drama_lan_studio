export const runtime = "nodejs";

import { requireUser } from "@/lib/auth/guards";
import { ServiceError, toErrorResponse } from "@/lib/services/errors";
import { enqueueImageGeneration, getImagesWorkspaceData } from "@/lib/services/images";

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

    const contentLengthHeader = request.headers.get("content-length");
    if (contentLengthHeader) {
      const parsed = Number(contentLengthHeader);
      if (Number.isFinite(parsed) && parsed > maxBytes + 64 * 1024) {
        return toPayloadTooLargeResponse("Payload too large");
      }
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

    if (sourceAssetId && sourceFile) {
      throw new ServiceError(400, "Provide either sourceAssetId or sourceFile, not both");
    }

    if (sourceFile && sourceFile instanceof File) {
      if (sourceFile.size > maxBytes) {
        return toPayloadTooLargeResponse("Payload too large");
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
