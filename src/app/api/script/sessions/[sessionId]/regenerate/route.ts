import { requireUser } from "@/lib/auth/guards";
import { createSseResponse, streamTextAsSse } from "@/lib/streaming/sse";
import {
  generateScriptQuestion,
  regenerateCurrentQuestion,
} from "@/lib/services/script-sessions";
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

    await regenerateCurrentQuestion(sessionId, user.userId);

    const questionStream = await generateScriptQuestion({
      sessionId,
      userId: user.userId,
      mode: "regenerate",
    });

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
