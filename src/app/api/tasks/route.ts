import { TaskType, type Prisma } from "@prisma/client";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { createJsonObjectSchema, JsonStringSchema, parseJsonBody } from "@/lib/http/validation";
import { toErrorResponse } from "@/lib/services/errors";
import { createTask } from "@/lib/services/tasks";

const CreateTaskBodySchema = createJsonObjectSchema({
  projectId: JsonStringSchema,
  type: JsonStringSchema,
  inputJson: z.unknown().optional(),
}).superRefine((body, ctx) => {
  if (!body.projectId || !body.type || body.inputJson === undefined) {
    ctx.addIssue({
      code: "custom",
      message: "projectId, type, and inputJson are required",
    });
    return;
  }

  if (!Object.values(TaskType).includes(body.type as TaskType)) {
    ctx.addIssue({
      code: "custom",
      message: "Invalid task type",
    });
  }
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseJsonBody(request, CreateTaskBodySchema);

    const task = await createTask({
      projectId: body.projectId,
      createdById: user.userId,
      type: body.type as TaskType,
      inputJson: body.inputJson as Prisma.InputJsonValue,
    });

    return Response.json(task, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
