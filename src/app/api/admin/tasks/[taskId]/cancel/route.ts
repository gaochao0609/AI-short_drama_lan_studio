import { requireAdmin } from "@/lib/auth/guards";
import { toErrorResponse } from "@/lib/services/errors";
import { cancelAdminTask } from "@/lib/services/tasks";

type TaskCancelRouteContext = {
  params: Promise<{ taskId: string }> | { taskId: string };
};

async function readTaskId(context: TaskCancelRouteContext) {
  const params = await context.params;
  return params.taskId;
}

export async function POST(_request: Request, context: TaskCancelRouteContext) {
  try {
    await requireAdmin();
    const taskId = await readTaskId(context);
    const result = await cancelAdminTask(taskId);
    const status = result.status === "RUNNING" || result.status === "QUEUED" ? 202 : 200;

    return Response.json(result, { status });
  } catch (error) {
    return toErrorResponse(error);
  }
}
