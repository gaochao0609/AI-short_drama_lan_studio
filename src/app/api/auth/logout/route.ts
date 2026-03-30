import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth/guards";
import { getSessionCookieOptions, hashSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { toErrorResponse } from "@/lib/services/errors";
import { logoutBySession } from "@/lib/services/users";

function buildClearedSessionCookie() {
  const cookieOptions = getSessionCookieOptions(process.env.APP_URL ?? "");

  return [
    `${SESSION_COOKIE_NAME}=`,
    `Path=${cookieOptions.path}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(cookieOptions.secure ? ["Secure"] : []),
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ].join("; ");
}

export async function POST() {
  try {
    await requireUser();

    const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;

    if (token) {
      const session = await prisma.session.findUnique({
        where: {
          tokenHash: hashSessionToken(token),
        },
        select: {
          id: true,
        },
      });

      if (session) {
        await logoutBySession(session.id);
      }
    }

    const response = Response.json({ ok: true }, { status: 200 });

    response.headers.set("set-cookie", buildClearedSessionCookie());

    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}
