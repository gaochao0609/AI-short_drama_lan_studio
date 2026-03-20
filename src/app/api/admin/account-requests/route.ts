import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { createJsonObjectSchema, JsonStringSchema, parseJsonBody } from "@/lib/http/validation";
import { approveAccountRequest } from "@/lib/services/account-requests";
import { toErrorResponse } from "@/lib/services/errors";

const ApproveAccountRequestBodySchema = createJsonObjectSchema({
  requestId: JsonStringSchema,
}).refine((body) => Boolean(body.requestId), {
  message: "requestId is required",
});

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
    const body = await parseJsonBody(request, ApproveAccountRequestBodySchema);

    const result = await approveAccountRequest(body.requestId, admin.userId);

    return Response.json(result, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
