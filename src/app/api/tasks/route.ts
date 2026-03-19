import { TaskType, type Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/guards";
import { toErrorResponse } from "@/lib/services/errors";
import { createTask } from "@/lib/services/tasks";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const rawBody = (await request.json()) as unknown;
    const body =
      typeof rawBody === "object" && rawBody !== null
        ? (rawBody as { projectId?: unknown; type?: unknown; inputJson?: unknown })
        : {};
    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    const type = typeof body.type === "string" ? body.type : "";

    if (!projectId || !type || body.inputJson === undefined) {
      return Response.json(
        {
          error: "projectId, type, and inputJson are required",
        },
        {
          status: 400,
        },
      );
    }

    if (!Object.values(TaskType).includes(type as TaskType)) {
      return Response.json(
        {
          error: "Invalid task type",
        },
        {
          status: 400,
        },
      );
    }

    const task = await createTask({
      projectId,
      createdById: user.userId,
      type: type as TaskType,
      inputJson: body.inputJson as Prisma.InputJsonValue,
    });

    return Response.json(task, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
