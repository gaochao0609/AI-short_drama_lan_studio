import { randomBytes } from "node:crypto";
import { Prisma, UserRole, UserStatus } from "@prisma/client";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/services/errors";

const USERNAME_RESERVATION_LOCK_NAMESPACE = 501;

function buildTempPassword() {
  return `Temp-${randomBytes(9).toString("base64url")}1!`;
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

function mapPrismaError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new ServiceError(409, "Account request or user already exists");
  }

  throw error;
}

export async function createAccountRequest(input: {
  username: string;
  displayName: string;
  reason?: string;
}): Promise<{ requestId: string; status: "PENDING" }> {
  const username = input.username.trim();
  const displayName = input.displayName.trim();
  const reason = input.reason?.trim();

  try {
    const request = await prisma.$transaction(async (tx) => {
      await lockUsernameReservation(tx, username);

      const existingUser = await tx.user.findUnique({
        where: {
          username,
        },
        select: {
          id: true,
        },
      });

      if (existingUser) {
        throw new ServiceError(409, "Account request or user already exists");
      }

      return tx.accountRequest.create({
        data: {
          username,
          displayName,
          reason: reason ? reason : null,
          status: "PENDING",
        },
        select: {
          id: true,
          status: true,
        },
      });
    });

    return {
      requestId: request.id,
      status: "PENDING",
    };
  } catch (error) {
    mapPrismaError(error);
  }
}

export async function approveAccountRequest(
  requestId: string,
  adminUserId: string,
): Promise<{ userId: string; tempPassword: string }> {
  const tempPassword = buildTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  try {
    return await prisma.$transaction(async (tx) => {
      const accountRequest = await tx.accountRequest.findUnique({
        where: {
          id: requestId,
        },
        select: {
          id: true,
          username: true,
          status: true,
        },
      });

      if (!accountRequest) {
        throw new ServiceError(404, "Account request not found");
      }

      if (accountRequest.status !== "PENDING") {
        throw new ServiceError(409, "Account request has already been processed");
      }

      const user = await tx.user.create({
        data: {
          username: accountRequest.username,
          passwordHash,
          role: UserRole.USER,
          status: UserStatus.ACTIVE,
          forcePasswordChange: true,
        },
        select: {
          id: true,
        },
      });

      await tx.accountRequest.update({
        where: {
          id: accountRequest.id,
        },
        data: {
          status: "APPROVED",
          approvedById: adminUserId,
          approvedAt: new Date(),
        },
      });

      return {
        userId: user.id,
        tempPassword,
      };
    });
  } catch (error) {
    mapPrismaError(error);
  }
}
