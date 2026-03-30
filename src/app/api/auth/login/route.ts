import { headers } from "next/headers";
import { createSession, getSessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createJsonObjectSchema, JsonStringSchema, JsonTrimmedStringSchema, parseJsonBody } from "@/lib/http/validation";
import { toErrorResponse } from "@/lib/services/errors";
import { authenticateUser } from "@/lib/services/users";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LoginBodySchema = createJsonObjectSchema({
  username: JsonTrimmedStringSchema,
  password: JsonStringSchema,
}).refine((body) => Boolean(body.username && body.password), {
  message: "username and password are required",
});

function buildSessionCookie(token: string, expiresAt: Date) {
  const cookieOptions = getSessionCookieOptions(process.env.APP_URL ?? "");

  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    `Path=${cookieOptions.path}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(cookieOptions.secure ? ["Secure"] : []),
    `Expires=${expiresAt.toUTCString()}`,
  ].join("; ");
}

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request, LoginBodySchema);

    const authenticatedUser = await authenticateUser(body.username, body.password);
    const requestHeaders = await headers();
    const forwardedFor = requestHeaders.get("x-forwarded-for");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const session = await createSession({
      userId: authenticatedUser.userId,
      ip: forwardedFor?.split(",")[0]?.trim() || undefined,
      userAgent: requestHeaders.get("user-agent") ?? undefined,
      expiresAt,
    });
    const response = Response.json(authenticatedUser, { status: 200 });

    response.headers.set("set-cookie", buildSessionCookie(session.token, expiresAt));

    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}
