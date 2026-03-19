import { UserRole, UserStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { ServiceError, toErrorResponse } from "@/lib/services/errors";
import { createUser, disableUser, invalidateUserSessions } from "@/lib/services/users";

export async function GET() {
  try {
    await requireAdmin();

    const users = await prisma.user.findMany({
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        username: true,
        role: true,
        status: true,
        forcePasswordChange: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return Response.json({ users }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = (await request.json()) as {
      username?: unknown;
      role?: unknown;
    };
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const role = typeof body.role === "string" ? body.role : "";

    if (!username || !role) {
      return Response.json(
        {
          error: "username and role are required",
        },
        {
          status: 400,
        },
      );
    }

    if (!Object.values(UserRole).includes(role as UserRole)) {
      return Response.json(
        {
          error: "Invalid role",
        },
        {
          status: 400,
        },
      );
    }

    const result = await createUser({
      username,
      role: role as UserRole,
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = (await request.json()) as {
      userId?: unknown;
      status?: unknown;
    };
    const userId = typeof body.userId === "string" ? body.userId : "";
    const status = typeof body.status === "string" ? body.status : "";

    if (!userId || !status) {
      return Response.json(
        {
          error: "userId and status are required",
        },
        {
          status: 400,
        },
      );
    }

    if (!Object.values(UserStatus).includes(status as UserStatus)) {
      return Response.json(
        {
          error: "Invalid status",
        },
        {
          status: 400,
        },
      );
    }

    if (status === UserStatus.DISABLED) {
      await disableUser(userId, admin.userId);
    } else {
      const result = await prisma.user.updateMany({
        where: {
          id: userId,
        },
        data: {
          status: status as UserStatus,
        },
      });

      if (result.count === 0) {
        throw new ServiceError(404, "User not found");
      }

      await invalidateUserSessions(userId);
    }

    return Response.json(
      {
        userId,
        status,
      },
      {
        status: 200,
      },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
