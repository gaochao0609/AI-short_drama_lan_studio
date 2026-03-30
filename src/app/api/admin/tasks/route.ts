import { requireAdmin } from "@/lib/auth/guards";
import { toErrorResponse } from "@/lib/services/errors";
import { listAdminTasks } from "@/lib/services/tasks";

export async function GET(_request: Request) {
  try {
    await requireAdmin();
    const tasks = await listAdminTasks();

    return Response.json({ tasks }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
