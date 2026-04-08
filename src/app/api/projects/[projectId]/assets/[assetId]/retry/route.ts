export const runtime = "nodejs";

import { requireUser } from "@/lib/auth/guards";
import { retryScriptSourceParse } from "@/lib/services/assets";
import { toErrorResponse } from "@/lib/services/errors";

type RetryProjectAssetRouteContext = {
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

async function readRouteParams(context: RetryProjectAssetRouteContext) {
  const params = await context.params;

  return {
    projectId: params.projectId,
    assetId: params.assetId,
  };
}

export async function POST(_request: Request, context: RetryProjectAssetRouteContext) {
  try {
    const user = await requireUser();
    const { projectId, assetId } = await readRouteParams(context);
    const result = await retryScriptSourceParse({
      projectId,
      assetId,
      userId: user.userId,
    });

    return Response.json(result, { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
