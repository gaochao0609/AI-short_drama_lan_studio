import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock, findUniqueMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  findUniqueMock: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    session: {
      findUnique: findUniqueMock,
    },
  },
}));

import { requireAdmin, requireUser } from "@/lib/auth/guards";

function restoreSessionSecret(previousSessionSecret: string | undefined) {
  if (previousSessionSecret === undefined) {
    delete process.env.SESSION_SECRET;
  } else {
    process.env.SESSION_SECRET = previousSessionSecret;
  }
}

function setSessionCookie(token?: string) {
  cookiesMock.mockResolvedValue({
    get: vi.fn((name: string) => {
      if (name !== "session" || token === undefined) {
        return undefined;
      }

      return { name, value: token };
    }),
  });
}

function buildSession(overrides: {
  expiresAt?: Date;
  revokedAt?: Date | null;
  role?: "ADMIN" | "USER";
  forcePasswordChange?: boolean;
} = {}) {
  return {
    id: "session-1",
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000),
    revokedAt: overrides.revokedAt ?? null,
    user: {
      id: "user-1",
      role: overrides.role ?? "USER",
      forcePasswordChange: overrides.forcePasswordChange ?? false,
    },
  };
}

describe("auth guards", () => {
  let previousSessionSecret: string | undefined;

  beforeEach(() => {
    previousSessionSecret = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "12345678901234567890123456789012";
    cookiesMock.mockReset();
    findUniqueMock.mockReset();
  });

  afterEach(() => {
    restoreSessionSecret(previousSessionSecret);
  });

  it("throws 401 when the session cookie is missing", async () => {
    setSessionCookie();

    await expect(requireUser()).rejects.toMatchObject({ status: 401 });
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("throws 401 when the session is expired", async () => {
    setSessionCookie("expired-token");
    findUniqueMock.mockResolvedValue(
      buildSession({
        expiresAt: new Date(Date.now() - 60_000),
      }),
    );

    await expect(requireUser()).rejects.toMatchObject({ status: 401 });
  });

  it("throws 401 when the session is revoked", async () => {
    setSessionCookie("revoked-token");
    findUniqueMock.mockResolvedValue(
      buildSession({
        revokedAt: new Date(),
      }),
    );

    await expect(requireUser()).rejects.toMatchObject({ status: 401 });
  });

  it("throws 403 when a non-admin requests admin access", async () => {
    setSessionCookie("user-token");
    findUniqueMock.mockResolvedValue(
      buildSession({
        role: "USER",
      }),
    );

    await expect(requireAdmin()).rejects.toMatchObject({ status: 403 });
  });

  it("allows force-password-change users through requireUser", async () => {
    setSessionCookie("force-change-token");
    findUniqueMock.mockResolvedValue(
      buildSession({
        forcePasswordChange: true,
      }),
    );

    await expect(requireUser()).resolves.toEqual({
      userId: "user-1",
      role: "USER",
      forcePasswordChange: true,
    });
  });
});
