export const runtime = "nodejs";

import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { ServiceError, toErrorResponse } from "@/lib/services/errors";
import {
  enqueueVideoGeneration,
  getVideosWorkspaceData,
  readOwnedVideoAsset,
} from "@/lib/services/videos";
import { parseJsonBody } from "@/lib/http/validation";

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

      return new Response(asset.bytes, {
        status: 200,
        headers: {
          "cache-control": "private, max-age=60",
          "content-length": String(asset.bytes.length),
          "content-type": asset.mimeType,
          "content-disposition": `inline; filename="${asset.originalName ?? `${asset.id}.bin`}"`,
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
