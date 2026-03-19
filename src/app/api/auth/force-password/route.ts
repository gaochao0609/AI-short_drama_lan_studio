import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth/guards";
import { hashPassword } from "@/lib/auth/password";
import { hashSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { toErrorResponse } from "@/lib/services/errors";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      password?: unknown;
    };
    const password = typeof body.password === "string" ? body.password : "";

    if (!password) {
      return Response.json(
        {
          error: "password is required",
        },
        {
          status: 400,
        },
      );
    }

    const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    const currentSession = token
      ? await prisma.session.findUnique({
          where: {
            tokenHash: hashSessionToken(token),
          },
          select: {
            id: true,
          },
        })
      : null;

    await prisma.$transaction([
      prisma.user.update({
        where: {
          id: user.userId,
        },
        data: {
          passwordHash: await hashPassword(password),
          forcePasswordChange: false,
        },
      }),
      prisma.session.updateMany({
        where: {
          userId: user.userId,
          revokedAt: null,
          id: currentSession ? { not: currentSession.id } : undefined,
        },
        data: {
          revokedAt: new Date(),
        },
      }),
    ]);

    return Response.json({ ok: true }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
