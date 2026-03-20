import { requireUser } from "@/lib/auth/guards";
import { createJsonObjectSchema, JsonOptionalTrimmedStringSchema, JsonTrimmedStringSchema, parseJsonBody } from "@/lib/http/validation";
import { createProject, listProjects } from "@/lib/services/projects";
import { toErrorResponse } from "@/lib/services/errors";

const CreateProjectBodySchema = createJsonObjectSchema({
  title: JsonTrimmedStringSchema,
  idea: JsonOptionalTrimmedStringSchema,
}).refine((body) => Boolean(body.title), {
  message: "title is required",
});

export async function GET() {
  try {
    const user = await requireUser();
    const projects = await listProjects(user.userId);

    return Response.json({ projects }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseJsonBody(request, CreateProjectBodySchema);

    const project = await createProject({
      ownerId: user.userId,
      title: body.title,
      idea: body.idea,
    });

    return Response.json(project, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
