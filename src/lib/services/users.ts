import { randomBytes } from "node:crypto";
import { Prisma, UserRole, UserStatus } from "@prisma/client";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { invalidateSession, invalidateUserSessions } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/services/errors";

const USERNAME_RESERVATION_LOCK_NAMESPACE = 501;

function buildTempPassword() {
  return `Reset-${randomBytes(9).toString("base64url")}1!`;
}

function buildInitialPassword() {
  return `Init-${randomBytes(9).toString("base64url")}1!`;
}

async function lockUsernameReservation(
  tx: Prisma.TransactionClient,
  username: string,
) {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      ${USERNAME_RESERVATION_LOCK_NAMESPACE},
      hashtext(${username})
    )
  `;
}

function mapMissingUserError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
    throw new ServiceError(404, "User not found");
  }

  throw error;
}

export async function authenticateUser(
  username: string,
  password: string,
): Promise<{ userId: string; role: "ADMIN" | "USER"; forcePasswordChange: boolean }> {
  const user = await prisma.user.findUnique({
    where: {
      username: username.trim(),
    },
    select: {
      id: true,
      passwordHash: true,
      role: true,
      status: true,
      forcePasswordChange: true,
    },
  });

  if (!user) {
    throw new ServiceError(401, "Invalid username or password");
  }

  if (user.status !== UserStatus.ACTIVE) {
    throw new ServiceError(403, "Account is disabled");
  }

  const isValidPassword = await verifyPassword(password, user.passwordHash);

  if (!isValidPassword) {
    throw new ServiceError(401, "Invalid username or password");
  }

  return {
    userId: user.id,
    role: user.role,
    forcePasswordChange: user.forcePasswordChange,
  };
}

export async function createUser(input: {
  username: string;
  role: UserRole;
}): Promise<{ userId: string; tempPassword: string }> {
  const username = input.username.trim();
  const tempPassword = buildInitialPassword();
  const passwordHash = await hashPassword(tempPassword);

  try {
    const user = await prisma.$transaction(async (tx) => {
      await lockUsernameReservation(tx, username);

      const pendingAccountRequest = await tx.accountRequest.findFirst({
        where: {
          username,
          status: "PENDING",
        },
        select: {
          id: true,
        },
      });

      if (pendingAccountRequest) {
        throw new ServiceError(409, "Username is reserved by a pending account request");
      }

      return tx.user.create({
        data: {
          username,
          passwordHash,
          role: input.role,
          status: UserStatus.ACTIVE,
          forcePasswordChange: true,
        },
        select: {
          id: true,
        },
      });
    });

    return {
      userId: user.id,
      tempPassword,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ServiceError(409, "User already exists");
    }

    throw error;
  }
}

export async function resetUserPassword(
  userId: string,
  adminUserId: string,
): Promise<{ tempPassword: string }> {
  void adminUserId;

  const tempPassword = buildTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  try {
    await prisma.$transaction([
      prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          passwordHash,
          forcePasswordChange: true,
        },
      }),
      prisma.session.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      }),
    ]);
  } catch (error) {
    mapMissingUserError(error);
  }

  return {
    tempPassword,
  };
}

export async function disableUser(userId: string, adminUserId: string): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const activeAdmins = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "users"
        WHERE "role" = ${UserRole.ADMIN}::"UserRole"
          AND "status" = ${UserStatus.ACTIVE}::"UserStatus"
        FOR UPDATE
      `);

      const user = await tx.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          id: true,
          role: true,
          status: true,
        },
      });

      if (!user) {
        throw new ServiceError(404, "User not found");
      }

      if (user.role === UserRole.ADMIN) {
        if (user.id === adminUserId) {
          throw new ServiceError(409, "An admin cannot disable their own account");
        }

        if (user.status === UserStatus.ACTIVE) {
          if (activeAdmins.length <= 1) {
            throw new ServiceError(409, "Cannot disable the last active admin");
          }
        }
      }

      await tx.user.update({
        where: {
          id: userId,
        },
        data: {
          status: UserStatus.DISABLED,
        },
      });

      await tx.session.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    });
  } catch (error) {
    mapMissingUserError(error);
  }
}

export async function logoutBySession(sessionId: string): Promise<void> {
  await invalidateSession(sessionId);
}

export { invalidateUserSessions };
