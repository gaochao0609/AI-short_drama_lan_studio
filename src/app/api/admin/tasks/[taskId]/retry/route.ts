import { requireAdmin } from "@/lib/auth/guards";
import { toErrorResponse } from "@/lib/services/errors";
import { retryAdminTask } from "@/lib/services/tasks";

type TaskRetryRouteContext = {
  params: Promise<{ taskId: string }> | { taskId: string };
};

async function readTaskId(context: TaskRetryRouteContext) {
  const params = await context.params;
  return params.taskId;
}

export async function POST(_request: Request, context: TaskRetryRouteContext) {
  try {
    await requireAdmin();
    const taskId = await readTaskId(context);
    const result = await retryAdminTask(taskId);

    return Response.json(result, { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
