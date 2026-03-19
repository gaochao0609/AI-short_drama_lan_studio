import { requireAdmin } from "@/lib/auth/guards";
import { resetUserPassword } from "@/lib/services/users";
import { toErrorResponse } from "@/lib/services/errors";

export async function POST(
  _request: Request,
  context: {
    params: Promise<{ userId: string }> | { userId: string };
  },
) {
  try {
    const admin = await requireAdmin();
    const { userId } = await context.params;
    const result = await resetUserPassword(userId, admin.userId);

    return Response.json(result, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
