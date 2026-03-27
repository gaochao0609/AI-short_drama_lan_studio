import { requireUser } from "@/lib/auth/guards";
import { finalizeScriptSession } from "@/lib/services/script-sessions";
import { toErrorResponse } from "@/lib/services/errors";

type SessionRouteContext = {
  params: Promise<{ sessionId: string }> | { sessionId: string };
};

async function readSessionId(context: SessionRouteContext) {
  const params = await context.params;
  return params.sessionId;
}

export async function POST(_request: Request, context: SessionRouteContext) {
  try {
    const user = await requireUser();
    const sessionId = await readSessionId(context);
    const result = await finalizeScriptSession(sessionId, user.userId);

    return Response.json(result, { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
