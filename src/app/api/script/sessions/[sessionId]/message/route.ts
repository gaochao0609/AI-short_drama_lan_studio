import { createJsonObjectSchema, JsonTrimmedStringSchema, parseJsonBody } from "@/lib/http/validation";
import { requireUser } from "@/lib/auth/guards";
import { createSseResponse, streamTextAsSse } from "@/lib/streaming/sse";
import { answerScriptQuestion, generateScriptQuestion } from "@/lib/services/script-sessions";
import { toErrorResponse } from "@/lib/services/errors";

type SessionRouteContext = {
  params: Promise<{ sessionId: string }> | { sessionId: string };
};

const AnswerBodySchema = createJsonObjectSchema({
  answer: JsonTrimmedStringSchema,
}).refine((body) => Boolean(body.answer), {
  message: "answer is required",
});

async function readSessionId(context: SessionRouteContext) {
  const params = await context.params;
  return params.sessionId;
}

export async function POST(request: Request, context: SessionRouteContext) {
  try {
    const user = await requireUser();
    const sessionId = await readSessionId(context);
    const body = await parseJsonBody(request, AnswerBodySchema);

    await answerScriptQuestion(sessionId, body.answer, user.userId);

    const questionStream = await generateScriptQuestion({
      sessionId,
      userId: user.userId,
      mode: "next",
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
