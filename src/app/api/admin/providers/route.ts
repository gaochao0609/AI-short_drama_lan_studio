import { ZodError } from "zod";
import { requireAdmin } from "@/lib/auth/guards";
import { listDefaultModelSummaries } from "@/lib/models/provider-registry";
import { createProvider, listProviders, updateProvider } from "@/lib/services/providers";
import { toErrorResponse } from "@/lib/services/errors";

function toValidationErrorResponse(error: ZodError) {
  const issue = error.issues[0];

  return Response.json(
    {
      error: issue?.message ?? "Invalid request payload",
    },
    {
      status: 400,
    },
  );
}

export async function GET() {
  try {
    await requireAdmin();
    const [providers, defaultModels] = await Promise.all([listProviders(), listDefaultModelSummaries()]);

    return Response.json(
      {
        providers,
        defaultModels,
      },
      {
        status: 200,
      },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const provider = await createProvider(await request.json());

    return Response.json(
      {
        provider,
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return toValidationErrorResponse(error);
    }

    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const provider = await updateProvider(await request.json());

    return Response.json(
      {
        provider,
      },
      {
        status: 200,
      },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return toValidationErrorResponse(error);
    }

    return toErrorResponse(error);
  }
}
