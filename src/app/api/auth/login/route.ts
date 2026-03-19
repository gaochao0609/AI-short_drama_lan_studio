import { headers } from "next/headers";
import { createSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { toErrorResponse, shouldUseSecureCookies } from "@/lib/services/errors";
import { authenticateUser } from "@/lib/services/users";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function buildSessionCookie(token: string, expiresAt: Date) {
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...(shouldUseSecureCookies() ? ["Secure"] : []),
    `Expires=${expiresAt.toUTCString()}`,
  ].join("; ");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      username?: unknown;
      password?: unknown;
    };
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!username || !password) {
      return Response.json(
        {
          error: "username and password are required",
        },
        {
          status: 400,
        },
      );
    }

    const authenticatedUser = await authenticateUser(username, password);
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
