import { AuthGuardError } from "@/lib/auth/guards";

export class ServiceError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export function toErrorResponse(error: unknown) {
  if (error instanceof ServiceError || error instanceof AuthGuardError) {
    return Response.json(
      {
        error: error.message,
      },
      {
        status: error.status,
      },
    );
  }

  console.error(error);

  return Response.json(
    {
      error: "Internal server error",
    },
    {
      status: 500,
    },
  );
}
