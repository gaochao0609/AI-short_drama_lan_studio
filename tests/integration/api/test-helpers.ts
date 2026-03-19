import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { createSessionToken, hashSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { vi } from "vitest";

type RequestContextInput = {
  sessionToken?: string;
  userAgent?: string;
  forwardedFor?: string;
  cookies?: Record<string, string>;
};

const requestContext = {
  sessionToken: undefined as string | undefined,
  userAgent: "vitest-integration",
  forwardedFor: "127.0.0.1",
  cookies: {} as Record<string, string>,
};

const cookiesMock = vi.fn(async () => ({
  get(name: string) {
    if (name === SESSION_COOKIE_NAME && requestContext.sessionToken !== undefined) {
      return { name, value: requestContext.sessionToken };
    }

    const cookieValue = requestContext.cookies[name];
    if (cookieValue !== undefined) {
      return { name, value: cookieValue };
    }

    return undefined;
  },
}));

const headersMock = vi.fn(
  async () =>
    new Headers({
      "x-forwarded-for": requestContext.forwardedFor,
      "user-agent": requestContext.userAgent,
    }),
);

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
  headers: headersMock,
}));

export function setRequestContext(input: RequestContextInput = {}) {
  requestContext.sessionToken = input.sessionToken;
  requestContext.userAgent = input.userAgent ?? "vitest-integration";
  requestContext.forwardedFor = input.forwardedFor ?? "127.0.0.1";
  requestContext.cookies = { ...(input.cookies ?? {}) };
}

export function resetRequestContext() {
  setRequestContext();
  cookiesMock.mockClear();
  headersMock.mockClear();
}

export function applyRouteTestEnv(
  databaseUrl: string,
  overrides: Partial<Record<string, string>> = {},
) {
  const nextValues: Record<string, string> = {
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: "12345678901234567890123456789012",
    APP_URL: "http://127.0.0.1:3000",
    REDIS_URL: "redis://127.0.0.1:6379",
    STORAGE_ROOT: "./.tmp/integration-storage",
    MAX_UPLOAD_MB: "25",
    DEFAULT_ADMIN_USERNAME: "seed-admin",
    DEFAULT_ADMIN_PASSWORD: "seed-admin-password",
    ...overrides,
  };
  const previousValues = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(nextValues)) {
    previousValues.set(key, process.env[key]);
    process.env[key] = value;
  }

  return () => {
    for (const [key, value] of previousValues.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

export async function importRouteModule<TModule>(modulePath: string): Promise<TModule> {
  vi.resetModules();

  const resolvedPath = modulePath.startsWith("@/")
    ? path.resolve(process.cwd(), "src", `${modulePath.slice(2)}.ts`)
    : path.resolve(process.cwd(), `${modulePath}.ts`);

  return import(pathToFileURL(resolvedPath).href) as Promise<TModule>;
}

export function createJsonRequest(
  pathname: string,
  method: "POST" | "PATCH" | "GET",
  body?: unknown,
) {
  return new Request(`http://localhost${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function createSessionRecord(
  prisma: PrismaClient,
  input: {
    userId: string;
    expiresAt?: Date;
    revokedAt?: Date | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
) {
  const token = createSessionToken();
  const session = await prisma.session.create({
    data: {
      userId: input.userId,
      tokenHash: hashSessionToken(token),
      expiresAt: input.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
      revokedAt: input.revokedAt ?? null,
      ipAddress: input.ipAddress ?? "127.0.0.1",
      userAgent: input.userAgent ?? "vitest-integration",
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

export function readSetCookieHeader(response: Response) {
  return response.headers.get("set-cookie");
}

export function isClearedSessionCookie(setCookieHeader: string | null) {
  if (!setCookieHeader) {
    return false;
  }

  const normalizedHeader = setCookieHeader.toLowerCase();
  return (
    normalizedHeader.includes(`${SESSION_COOKIE_NAME}=`) &&
    (normalizedHeader.includes("max-age=0") ||
      normalizedHeader.includes("expires=thu, 01 jan 1970"))
  );
}

export { SESSION_COOKIE_NAME };
