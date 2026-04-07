export const runtime = "nodejs";

import { requireUser } from "@/lib/auth/guards";
import { deleteProjectAsset } from "@/lib/services/assets";
import { toErrorResponse } from "@/lib/services/errors";

type ProjectAssetRouteContext = {
  params:
    | Promise<{
        projectId: string;
        assetId: string;
      }>
    | {
        projectId: string;
        assetId: string;
      };
};

async function readRouteParams(context: ProjectAssetRouteContext) {
  const params = await context.params;

  return {
    projectId: params.projectId,
    assetId: params.assetId,
  };
}

export async function DELETE(_request: Request, context: ProjectAssetRouteContext) {
  try {
    const user = await requireUser();
    const { projectId, assetId } = await readRouteParams(context);
    const payload = await deleteProjectAsset({
      projectId,
      assetId,
      userId: user.userId,
    });

    return Response.json(payload, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
