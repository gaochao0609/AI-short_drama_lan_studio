import { cookies } from "next/headers";
import { hashSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";

class AuthGuardError extends Error {
  constructor(
    public readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = "AuthGuardError";
  }
}

async function getAuthenticatedUser() {
  const { prisma } = await import("@/lib/db");
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    throw new AuthGuardError(401, "Unauthorized");
  }

  const session = await prisma.session.findUnique({
    where: {
      tokenHash: hashSessionToken(token),
    },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      user: {
        select: {
          id: true,
          role: true,
          forcePasswordChange: true,
        },
      },
    },
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    throw new AuthGuardError(401, "Unauthorized");
  }

  return {
    sessionId: session.id,
    userId: session.user.id,
    role: session.user.role,
    forcePasswordChange: session.user.forcePasswordChange,
  };
}

export async function requireUser(): Promise<{
  userId: string;
  role: "ADMIN" | "USER";
  forcePasswordChange: boolean;
}> {
  const user = await getAuthenticatedUser();

  return {
    userId: user.userId,
    role: user.role,
    forcePasswordChange: user.forcePasswordChange,
  };
}

export async function requireAdmin(): Promise<{
  userId: string;
  role: "ADMIN";
}> {
  const user = await requireUser();

  if (user.role !== "ADMIN") {
    throw new AuthGuardError(403, "Forbidden");
  }

  return {
    userId: user.userId,
    role: user.role,
  };
}

export { AuthGuardError };
