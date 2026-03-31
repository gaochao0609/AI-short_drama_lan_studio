import { requireAdmin } from "@/lib/auth/guards";
import { toErrorResponse } from "@/lib/services/errors";
import { listAdminTasks } from "@/lib/services/tasks";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page")) || 1;
    const pageSize = Number(url.searchParams.get("pageSize")) || 50;
    const result = await listAdminTasks({ page, pageSize });

    return Response.json(result, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
