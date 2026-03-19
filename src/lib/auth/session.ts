import { createHmac, randomBytes } from "node:crypto";

const SESSION_COOKIE_NAME = "session";

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error("SESSION_SECRET is required");
  }

  return secret;
}

async function getPrisma() {
  const { prisma } = await import("@/lib/db");

  return prisma;
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHmac("sha256", getSessionSecret()).update(token).digest("hex");
}

export async function createSession(input: {
  userId: string;
  ip?: string;
  userAgent?: string;
  expiresAt: Date;
}): Promise<{ sessionId: string; token: string }> {
  const token = createSessionToken();
  const prisma = await getPrisma();
  const session = await prisma.session.create({
    data: {
      userId: input.userId,
      tokenHash: hashSessionToken(token),
      expiresAt: input.expiresAt,
      ipAddress: input.ip,
      userAgent: input.userAgent,
    },
    select: {
      id: true,
    },
  });

  return {
    sessionId: session.id,
    token,
  };
}

export async function invalidateSession(sessionId: string): Promise<void> {
  const prisma = await getPrisma();

  await prisma.session.updateMany({
    where: {
      id: sessionId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });
}

export async function invalidateUserSessions(userId: string): Promise<void> {
  const prisma = await getPrisma();

  await prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });
}

export { SESSION_COOKIE_NAME };
