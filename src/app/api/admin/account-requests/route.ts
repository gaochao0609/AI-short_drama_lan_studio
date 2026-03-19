import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { approveAccountRequest } from "@/lib/services/account-requests";
import { toErrorResponse } from "@/lib/services/errors";

export async function GET() {
  try {
    await requireAdmin();

    const requests = await prisma.accountRequest.findMany({
      where: {
        status: "PENDING",
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return Response.json({ requests }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = (await request.json()) as {
      requestId?: unknown;
    };
    const requestId = typeof body.requestId === "string" ? body.requestId : "";

    if (!requestId) {
      return Response.json(
        {
          error: "requestId is required",
        },
        {
          status: 400,
        },
      );
    }

    const result = await approveAccountRequest(requestId, admin.userId);

    return Response.json(result, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
