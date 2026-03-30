import { requireUser } from "@/lib/auth/guards";
import { createJsonObjectSchema, JsonOptionalTrimmedStringSchema, parseJsonBody } from "@/lib/http/validation";
import { getProject, updateProject } from "@/lib/services/projects";
import { toErrorResponse } from "@/lib/services/errors";

type ProjectRouteContext = {
  params: Promise<{ projectId: string }> | { projectId: string };
};

const UpdateProjectBodySchema = createJsonObjectSchema({
  title: JsonOptionalTrimmedStringSchema,
  idea: JsonOptionalTrimmedStringSchema,
  status: JsonOptionalTrimmedStringSchema,
}).refine(
  (body) => body.title !== undefined || body.idea !== undefined || body.status !== undefined,
  {
    message: "title, idea, or status is required",
  },
);

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
    const body = await parseJsonBody(request, UpdateProjectBodySchema);

    const project = await updateProject(projectId, user.userId, {
      title: body.title,
      idea: body.idea,
      status: body.status,
    });

    return Response.json(project, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
