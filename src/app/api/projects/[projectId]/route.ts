import { requireUser } from "@/lib/auth/guards";
import { getProject, updateProject } from "@/lib/services/projects";
import { toErrorResponse } from "@/lib/services/errors";

type ProjectRouteContext = {
  params: Promise<{ projectId: string }> | { projectId: string };
};

async function readProjectId(context: ProjectRouteContext) {
  const params = await context.params;
  return params.projectId;
}

export async function GET(_request: Request, context: ProjectRouteContext) {
  try {
    const user = await requireUser();
    const projectId = await readProjectId(context);
    const project = await getProject(projectId, user.userId);

    return Response.json(project, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: ProjectRouteContext) {
  try {
    const user = await requireUser();
    const projectId = await readProjectId(context);
    const rawBody = (await request.json()) as unknown;
    const body =
      typeof rawBody === "object" && rawBody !== null
        ? (rawBody as { title?: unknown; idea?: unknown; status?: unknown })
        : {};
    const title = typeof body.title === "string" ? body.title.trim() : undefined;
    const idea = typeof body.idea === "string" ? body.idea.trim() : undefined;
    const status = typeof body.status === "string" ? body.status.trim() : undefined;

    if (title === undefined && idea === undefined && status === undefined) {
      return Response.json(
        {
          error: "title, idea, or status is required",
        },
        {
          status: 400,
        },
      );
    }

    const project = await updateProject(projectId, user.userId, {
      title,
      idea,
      status,
    });

    return Response.json(project, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
