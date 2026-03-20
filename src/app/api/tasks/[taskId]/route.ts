import { requireUser } from "@/lib/auth/guards";
import { toErrorResponse } from "@/lib/services/errors";
import { getTask } from "@/lib/services/tasks";

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
    void request;
    void context;

    return Response.json(
      {
        error: "Task status updates are managed by the worker",
      },
      {
        status: 405,
        headers: {
          Allow: "GET",
        },
      },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
