import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PrismaClient } from "@prisma/client";
import { vi } from "vitest";

const defaultEnv = {
  APP_URL: "http://localhost:3000",
  DEFAULT_ADMIN_PASSWORD: "replace-with-a-strong-password",
  DEFAULT_ADMIN_USERNAME: "admin",
  MAX_UPLOAD_MB: "25",
  REDIS_URL: "redis://localhost:6379",
  SESSION_SECRET: "12345678901234567890123456789012",
  STORAGE_ROOT: "./storage",
} as const;

function restoreEnv(previousEnv: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function importLocalModule<T>(relativePath: string): Promise<T> {
  const moduleUrl = pathToFileURL(path.resolve(process.cwd(), relativePath)).href;
  return import(/* @vite-ignore */ moduleUrl) as Promise<T>;
}

export async function withApiTestEnv<T>(
  databaseUrl: string,
  callback: () => Promise<T>,
  envOverrides: Record<string, string> = {},
) {
  const nextEnv = {
    ...defaultEnv,
    ...envOverrides,
    DATABASE_URL: databaseUrl,
  };
  const previousEnv = Object.fromEntries(
    Object.keys(nextEnv).map((key) => [key, process.env[key]]),
  );

  Object.assign(process.env, nextEnv);
  vi.resetModules();

  try {
    return await callback();
  } finally {
    vi.doUnmock("next/headers");
    vi.resetModules();
    restoreEnv(previousEnv);
  }
}

export async function loadRouteModule<T>(
  relativePath: string,
  options: {
    sessionToken?: string;
    requestHeaders?: HeadersInit;
  } = {},
): Promise<T> {
  const requestHeaders = new Headers(options.requestHeaders ?? {});
  const cookieStore = {
    get(name: string) {
      if (name !== "session" || options.sessionToken === undefined) {
        return undefined;
      }

      return { name, value: options.sessionToken };
    },
  };

  if (options.sessionToken) {
    requestHeaders.set("cookie", `session=${options.sessionToken}`);
  }

  vi.doMock("next/headers", () => ({
    cookies: async () => cookieStore,
    headers: async () => requestHeaders,
  }));

  return importLocalModule<T>(relativePath);
}

export function jsonRequest(
  url: string,
  body?: unknown,
  init: Omit<RequestInit, "body"> = {},
) {
  const headers = new Headers(init.headers ?? {});

  if (!headers.has("content-type") && body !== undefined) {
    headers.set("content-type", "application/json");
  }

  return new Request(url, {
    ...init,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function hashPasswordForTest(password: string) {
  const { hashPassword } = await importLocalModule<typeof import("../../../src/lib/auth/password")>(
    "src/lib/auth/password.ts",
  );

  return hashPassword(password);
}

export async function insertSessionForUser(prisma: PrismaClient, userId: string) {
  const { createSessionToken, hashSessionToken } = await importLocalModule<
    typeof import("../../../src/lib/auth/session")
  >(
    "src/lib/auth/session.ts",
  );
  const token = createSessionToken();
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
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
