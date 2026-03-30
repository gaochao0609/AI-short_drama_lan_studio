import { requireUser } from "@/lib/auth/guards";
import {
  createJsonObjectSchema,
  JsonTrimmedStringSchema,
  parseJsonBody,
} from "@/lib/http/validation";
import { toErrorResponse } from "@/lib/services/errors";
import { createStoryboardTask } from "@/lib/services/storyboards";

const CreateStoryboardBodySchema = createJsonObjectSchema({
  projectId: JsonTrimmedStringSchema,
  scriptVersionId: JsonTrimmedStringSchema,
}).refine(
  (body) => Boolean(body.projectId) && Boolean(body.scriptVersionId),
  {
    message: "projectId and scriptVersionId are required",
  },
);

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseJsonBody(request, CreateStoryboardBodySchema);
    const result = await createStoryboardTask({
      projectId: body.projectId,
      scriptVersionId: body.scriptVersionId,
      userId: user.userId,
    });

    return Response.json(result, { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
