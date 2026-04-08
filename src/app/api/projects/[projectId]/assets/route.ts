export const runtime = "nodejs";

import { requireUser } from "@/lib/auth/guards";
import { getProjectWorkflowBinding } from "@/lib/services/asset-bindings";
import { ServiceError, toErrorResponse } from "@/lib/services/errors";
import { listProjectAssets, uploadProjectAsset } from "@/lib/services/assets";

type ProjectAssetsRouteContext = {
  params: Promise<{ projectId: string }> | { projectId: string };
};

async function readProjectId(context: ProjectAssetsRouteContext) {
  const params = await context.params;
  return params.projectId;
}

function isMultipartRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.toLowerCase().includes("multipart/form-data");
}

export async function GET(_request: Request, context: ProjectAssetsRouteContext) {
  try {
    const user = await requireUser();
    const projectId = await readProjectId(context);
    const [assetPayload, bindings] = await Promise.all([
      listProjectAssets(projectId, user.userId),
      getProjectWorkflowBinding(projectId, user.userId),
    ]);

    return Response.json(
      {
        ...assetPayload,
        bindings,
      },
      { status: 200 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request, context: ProjectAssetsRouteContext) {
  try {
    const user = await requireUser();
    const projectId = await readProjectId(context);

    if (!isMultipartRequest(request)) {
      throw new ServiceError(400, "multipart/form-data is required");
    }

    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      throw new ServiceError(400, "file is required");
    }

    const result = await uploadProjectAsset({
      projectId,
      userId: user.userId,
      file,
    });

    return Response.json(result, { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
