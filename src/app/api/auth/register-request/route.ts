import { createAccountRequest } from "@/lib/services/account-requests";
import { toErrorResponse } from "@/lib/services/errors";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      username?: unknown;
      displayName?: unknown;
      reason?: unknown;
    };
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : undefined;

    if (!username || !displayName) {
      return Response.json(
        {
          error: "username and displayName are required",
        },
        {
          status: 400,
        },
      );
    }

    const result = await createAccountRequest({
      username,
      displayName,
      reason,
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
