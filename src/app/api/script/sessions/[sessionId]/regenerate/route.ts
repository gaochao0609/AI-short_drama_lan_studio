import { requireUser } from "@/lib/auth/guards";
import { createSseResponse, streamTextAsSse } from "@/lib/streaming/sse";
import { regenerateCurrentQuestion } from "@/lib/services/script-sessions";
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

    const questionStream = await regenerateCurrentQuestion(sessionId, user.userId);

    return createSseResponse(
      streamTextAsSse({
        upstream: questionStream.proxyStream,
        onComplete: questionStream.persistGeneratedQuestion,
      }),
      {
        status: 200,
      },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
