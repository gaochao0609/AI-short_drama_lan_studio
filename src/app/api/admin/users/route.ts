import { UserRole, UserStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { createJsonObjectSchema, JsonStringSchema, JsonTrimmedStringSchema, parseJsonBody } from "@/lib/http/validation";
import { ServiceError, toErrorResponse } from "@/lib/services/errors";
import { createUser, disableUser, invalidateUserSessions } from "@/lib/services/users";

const CreateUserBodySchema = createJsonObjectSchema({
  username: JsonTrimmedStringSchema,
  role: JsonStringSchema,
}).superRefine((body, ctx) => {
  if (!body.username || !body.role) {
    ctx.addIssue({
      code: "custom",
      message: "username and role are required",
    });
    return;
  }

  if (!Object.values(UserRole).includes(body.role as UserRole)) {
    ctx.addIssue({
      code: "custom",
      message: "Invalid role",
    });
  }
});

const UpdateUserStatusBodySchema = createJsonObjectSchema({
  userId: JsonStringSchema,
  status: JsonStringSchema,
}).superRefine((body, ctx) => {
  if (!body.userId || !body.status) {
    ctx.addIssue({
      code: "custom",
      message: "userId and status are required",
    });
    return;
  }

  if (!Object.values(UserStatus).includes(body.status as UserStatus)) {
    ctx.addIssue({
      code: "custom",
      message: "Invalid status",
    });
  }
});

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
    const body = await parseJsonBody(request, CreateUserBodySchema);

    const result = await createUser({
      username: body.username,
      role: body.role as UserRole,
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = await parseJsonBody(request, UpdateUserStatusBodySchema);

    if (body.status === UserStatus.DISABLED) {
      await disableUser(body.userId, admin.userId);
    } else {
      const result = await prisma.user.updateMany({
        where: {
          id: body.userId,
        },
        data: {
          status: body.status as UserStatus,
        },
      });

      if (result.count === 0) {
        throw new ServiceError(404, "User not found");
      }

      await invalidateUserSessions(body.userId);
    }

    return Response.json(
      {
        userId: body.userId,
        status: body.status,
      },
      {
        status: 200,
      },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
