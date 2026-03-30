import { requireUser } from "@/lib/auth/guards";
import { toErrorResponse } from "@/lib/services/errors";
import { getProjectDetail } from "@/lib/services/projects";

type ProjectDetailRouteContext = {
  params: Promise<{ projectId: string }> | { projectId: string };
};

async function readProjectId(context: ProjectDetailRouteContext) {
  const params = await context.params;
  return params.projectId;
}

export async function GET(_request: Request, context: ProjectDetailRouteContext) {
  try {
    const user = await requireUser();
    const projectId = await readProjectId(context);
    const project = await getProjectDetail(projectId, user.userId);

    return Response.json(project, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
