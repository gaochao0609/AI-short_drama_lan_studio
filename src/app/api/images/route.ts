export const runtime = "nodejs";

import { requireUser } from "@/lib/auth/guards";
import { ServiceError, toErrorResponse } from "@/lib/services/errors";
import { enqueueImageGeneration, getImagesWorkspaceData } from "@/lib/services/images";

const MULTIPART_OVERHEAD_BYTES = 256 * 1024;

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
    const legacySourceAssetId = String(form.get("sourceAssetId") ?? "").trim();
    const referenceAssetIds = form
      .getAll("referenceAssetIds")
      .map((value) => String(value).trim())
      .filter(Boolean);

    if (!projectId) {
      throw new ServiceError(400, "projectId is required");
    }

    if (!prompt) {
      throw new ServiceError(400, "prompt is required");
    }

    if (form.get("sourceFile") instanceof File) {
      throw new ServiceError(400, "sourceFile uploads must go through the asset center; send referenceAssetIds instead");
    }

    const result = await enqueueImageGeneration({
      projectId,
      prompt,
      referenceAssetIds,
      sourceAssetId: legacySourceAssetId || undefined,
      userId: user.userId,
    });

    return Response.json(result, { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
