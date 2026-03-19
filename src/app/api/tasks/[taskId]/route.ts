import { TaskStatus, type Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/guards";
import { toErrorResponse } from "@/lib/services/errors";
import { getTask, updateTask } from "@/lib/services/tasks";

type TaskRouteContext = {
  params: Promise<{ taskId: string }> | { taskId: string };
};

async function readTaskId(context: TaskRouteContext) {
  const params = await context.params;
  return params.taskId;
}

export async function GET(_request: Request, context: TaskRouteContext) {
  try {
    const user = await requireUser();
    const taskId = await readTaskId(context);
    const task = await getTask(taskId, user.userId);

    return Response.json(task, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: TaskRouteContext) {
  try {
    const user = await requireUser();
    const taskId = await readTaskId(context);
    const rawBody = (await request.json()) as unknown;
    const body =
      typeof rawBody === "object" && rawBody !== null
        ? (rawBody as { status?: unknown; outputJson?: unknown; errorText?: unknown })
        : {};
    const status = typeof body.status === "string" ? body.status : undefined;
    const errorText = typeof body.errorText === "string" ? body.errorText : undefined;

    if (status === undefined && body.outputJson === undefined && errorText === undefined) {
      return Response.json(
        {
          error: "status, outputJson, or errorText is required",
        },
        {
          status: 400,
        },
      );
    }

    if (status !== undefined && !Object.values(TaskStatus).includes(status as TaskStatus)) {
      return Response.json(
        {
          error: "Invalid task status",
        },
        {
          status: 400,
        },
      );
    }

    const task = await updateTask(taskId, user.userId, {
      status: status as TaskStatus | undefined,
      outputJson: body.outputJson as Prisma.InputJsonValue | undefined,
      errorText,
    });

    return Response.json(task, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
