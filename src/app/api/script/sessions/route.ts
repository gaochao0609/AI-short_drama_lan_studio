import { createJsonObjectSchema, JsonTrimmedStringSchema, parseJsonBody } from "@/lib/http/validation";
import { createSseResponse, streamTextAsSse } from "@/lib/streaming/sse";
import { requireUser } from "@/lib/auth/guards";
import { startScriptSession } from "@/lib/services/script-sessions";
import { toErrorResponse } from "@/lib/services/errors";

const StartScriptSessionBodySchema = createJsonObjectSchema({
  projectId: JsonTrimmedStringSchema,
  idea: JsonTrimmedStringSchema,
}).refine((body) => Boolean(body.projectId) && Boolean(body.idea), {
  message: "projectId and idea are required",
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseJsonBody(request, StartScriptSessionBodySchema);
    const questionStream = await startScriptSession(
      body.projectId,
      body.idea,
      user.userId,
    );

    return createSseResponse(
      streamTextAsSse({
        upstream: questionStream.proxyStream,
        initialEvents: [
          {
            event: "session",
            data: {
              sessionId: questionStream.sessionId,
            },
          },
        ],
        onComplete: questionStream.persistGeneratedQuestion,
        onError: questionStream.handleStreamingError,
      }),
      {
        status: 201,
      },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
