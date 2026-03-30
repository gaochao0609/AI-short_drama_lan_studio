export const runtime = "nodejs";

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { ServiceError, toErrorResponse } from "@/lib/services/errors";
import {
  enqueueVideoGeneration,
  getVideosWorkspaceData,
  readOwnedVideoAsset,
} from "@/lib/services/videos";
import { parseJsonBody } from "@/lib/http/validation";

function parseRangeHeader(rangeHeader: string | null, sizeBytes: number) {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) {
    throw new ServiceError(409, "Invalid Range header");
  }

  const [, startText, endText] = match;
  let start: number;
  let end: number;

  if (startText === "" && endText === "") {
    throw new ServiceError(409, "Invalid Range header");
  }

  if (startText === "") {
    const suffixLength = Number(endText);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      throw new ServiceError(409, "Invalid Range header");
    }

    start = Math.max(sizeBytes - suffixLength, 0);
    end = sizeBytes - 1;
  } else {
    start = Number(startText);
    end = endText === "" ? sizeBytes - 1 : Number(endText);
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= sizeBytes
  ) {
    throw new ServiceError(409, "Requested Range Not Satisfiable");
  }

  return {
    start,
    end: Math.min(end, sizeBytes - 1),
  };
}

const CreateVideoBodySchema = z.object({
  projectId: z.string().trim().min(1, "projectId is required"),
  prompt: z.string().trim().min(1, "prompt is required"),
  referenceAssetIds: z
    .array(z.string().trim().min(1, "referenceAssetIds must only contain strings"))
    .min(1, "referenceAssetIds is required"),
});

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId")?.trim();
    const assetId = url.searchParams.get("assetId")?.trim();

    if (!projectId) {
      throw new ServiceError(400, "projectId is required");
    }

    if (assetId) {
      const asset = await readOwnedVideoAsset({
        projectId,
        assetId,
        userId: user.userId,
      });
      const fileStat = await stat(asset.filePath);
      const range = parseRangeHeader(request.headers.get("range"), fileStat.size);
      const start = range?.start ?? 0;
      const end = range?.end ?? fileStat.size - 1;
      const contentLength = end - start + 1;
      const body = Readable.toWeb(createReadStream(asset.filePath, { start, end })) as ReadableStream;

      return new Response(body, {
        status: range ? 206 : 200,
        headers: {
          "accept-ranges": "bytes",
          "cache-control": "private, max-age=60",
          "content-length": String(contentLength),
          "content-type": asset.mimeType,
          "content-disposition": `inline; filename="${asset.originalName ?? `${asset.id}.bin`}"`,
          ...(range
            ? {
                "content-range": `bytes ${start}-${end}/${fileStat.size}`,
              }
            : {}),
        },
      });
    }

    const payload = await getVideosWorkspaceData(projectId, user.userId);
    return Response.json(payload, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseJsonBody(request, CreateVideoBodySchema);
    const result = await enqueueVideoGeneration({
      projectId: body.projectId,
      prompt: body.prompt,
      referenceAssetIds: body.referenceAssetIds,
      userId: user.userId,
    });

    return Response.json(result, { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
