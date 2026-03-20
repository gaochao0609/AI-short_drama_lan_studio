import { z, ZodError } from "zod";
import { ServiceError } from "@/lib/services/errors";

export const JsonStringSchema = z.preprocess((value) => (typeof value === "string" ? value : ""), z.string());

export const JsonTrimmedStringSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : ""),
  z.string(),
);

export const JsonOptionalStringSchema = z.preprocess(
  (value) => (typeof value === "string" ? value : undefined),
  z.string().optional(),
);

export const JsonOptionalTrimmedStringSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : undefined),
  z.string().optional(),
);

export function createJsonObjectSchema<TShape extends z.ZodRawShape>(shape: TShape) {
  return z.preprocess(
    (value) => (value !== null && typeof value === "object" && !Array.isArray(value) ? value : {}),
    z.object(shape),
  );
}

export async function parseJsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new ServiceError(400, "Invalid JSON body");
  }

  try {
    return schema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ServiceError(400, error.issues[0]?.message ?? "Invalid request payload");
    }

    throw error;
  }
}
