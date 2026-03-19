import { requireUser } from "@/lib/auth/guards";
import { createProject, listProjects } from "@/lib/services/projects";
import { toErrorResponse } from "@/lib/services/errors";

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
    const rawBody = (await request.json()) as unknown;
    const body =
      typeof rawBody === "object" && rawBody !== null
        ? (rawBody as { title?: unknown; idea?: unknown })
        : {};
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const idea = typeof body.idea === "string" ? body.idea.trim() : undefined;

    if (!title) {
      return Response.json(
        {
          error: "title is required",
        },
        {
          status: 400,
        },
      );
    }

    const project = await createProject({
      ownerId: user.userId,
      title,
      idea,
    });

    return Response.json(project, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
