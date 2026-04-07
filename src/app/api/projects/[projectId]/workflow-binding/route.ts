export const runtime = "nodejs";

import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { parseJsonBody } from "@/lib/http/validation";
import { getProjectWorkflowBinding, patchProjectWorkflowBinding } from "@/lib/services/asset-bindings";
import { toErrorResponse } from "@/lib/services/errors";

type ProjectWorkflowBindingRouteContext = {
  params: Promise<{ projectId: string }> | { projectId: string };
};

const PatchWorkflowBindingBodySchema = z
  .object({
    storyboardScriptAssetId: z.union([z.string().trim().min(1), z.null()]).optional(),
    imageReferenceAssetIds: z.array(z.string().trim().min(1)).optional(),
    videoReferenceAssetIds: z.array(z.string().trim().min(1)).optional(),
  })
  .refine(
    (body) =>
      body.storyboardScriptAssetId !== undefined ||
      body.imageReferenceAssetIds !== undefined ||
      body.videoReferenceAssetIds !== undefined,
    {
      message:
        "At least one of storyboardScriptAssetId, imageReferenceAssetIds, videoReferenceAssetIds is required",
    },
  );

async function readProjectId(context: ProjectWorkflowBindingRouteContext) {
  const params = await context.params;
  return params.projectId;
}

export async function GET(_request: Request, context: ProjectWorkflowBindingRouteContext) {
  try {
    const user = await requireUser();
    const projectId = await readProjectId(context);
    const binding = await getProjectWorkflowBinding(projectId, user.userId);

    return Response.json(binding, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: ProjectWorkflowBindingRouteContext) {
  try {
    const user = await requireUser();
    const projectId = await readProjectId(context);
    const body = await parseJsonBody(request, PatchWorkflowBindingBodySchema);
    const binding = await patchProjectWorkflowBinding({
      projectId,
      userId: user.userId,
      storyboardScriptAssetId: body.storyboardScriptAssetId,
      imageReferenceAssetIds: body.imageReferenceAssetIds,
      videoReferenceAssetIds: body.videoReferenceAssetIds,
    });

    return Response.json(binding, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
