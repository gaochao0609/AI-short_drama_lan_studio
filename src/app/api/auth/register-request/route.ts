import { createJsonObjectSchema, JsonOptionalTrimmedStringSchema, JsonTrimmedStringSchema, parseJsonBody } from "@/lib/http/validation";
import { createAccountRequest } from "@/lib/services/account-requests";
import { toErrorResponse } from "@/lib/services/errors";

const RegisterRequestBodySchema = createJsonObjectSchema({
  username: JsonTrimmedStringSchema,
  displayName: JsonTrimmedStringSchema,
  reason: JsonOptionalTrimmedStringSchema.transform((value) => (value && value.length > 0 ? value : undefined)),
}).refine((body) => Boolean(body.username && body.displayName), {
  message: "username and displayName are required",
});

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request, RegisterRequestBodySchema);

    const result = await createAccountRequest({
      username: body.username,
      displayName: body.displayName,
      reason: body.reason,
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
