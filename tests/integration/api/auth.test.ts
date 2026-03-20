import { UserRole, UserStatus } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTestDatabase } from "../db/test-database";
import {
  hashPasswordForTest,
  insertSessionForUser,
  jsonRequest,
  loadRouteModule,
  withApiTestEnv,
} from "./test-api";

afterEach(() => {
  vi.doUnmock("next/headers");
  vi.resetModules();
});

describe("auth api", () => {
  it("stores a pending account request", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const { POST } = await loadRouteModule<{
          POST: (request: Request) => Promise<Response>;
        }>("src/app/api/auth/register-request/route.ts");

        const response = await POST(
          jsonRequest("http://localhost/api/auth/register-request", {
            username: "pending-user",
            displayName: "Pending User",
            reason: "Need access",
          }, { method: "POST" }),
        );

        expect(response.status).toBe(201);
        await expect(response.json()).resolves.toEqual(
          expect.objectContaining({
            requestId: expect.any(String),
            status: "PENDING",
          }),
        );

        await expect(
          prisma.accountRequest.findUniqueOrThrow({
            where: { username: "pending-user" },
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            username: "pending-user",
            displayName: "Pending User",
            reason: "Need access",
            status: "PENDING",
          }),
        );
      });
    });
  });

  it("returns 400 when the register request body is malformed JSON", async () => {
    await withTestDatabase(async ({ databaseUrl }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const { POST } = await loadRouteModule<{
          POST: (request: Request) => Promise<Response>;
        }>("src/app/api/auth/register-request/route.ts");

        const response = await POST(
          new Request("http://localhost/api/auth/register-request", {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: "{",
          }),
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
          error: "Invalid JSON body",
        });
      });
    });
  });

  it("rejects a register request when the username already exists on a user", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const passwordHash = await hashPasswordForTest("ExistingUser123!");
        await prisma.user.create({
          data: {
            username: "existing-user",
            passwordHash,
            role: UserRole.USER,
            status: UserStatus.ACTIVE,
            forcePasswordChange: false,
          },
        });
        const { POST } = await loadRouteModule<{
          POST: (request: Request) => Promise<Response>;
        }>("src/app/api/auth/register-request/route.ts");

        const response = await POST(
          jsonRequest(
            "http://localhost/api/auth/register-request",
            {
              username: "existing-user",
              displayName: "Existing User",
              reason: "Need access",
            },
            { method: "POST" },
          ),
        );

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual(
          expect.objectContaining({
            error: "Account request or user already exists",
          }),
        );
        await expect(
          prisma.accountRequest.findUnique({
            where: { username: "existing-user" },
          }),
        ).resolves.toBeNull();
      });
    });
  });

  it("creates a session record and cookie on successful login", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const password = "WriterPass123!";
        const passwordHash = await hashPasswordForTest(password);
        const user = await prisma.user.create({
          data: {
            username: "writer-login",
            passwordHash,
            role: UserRole.USER,
            status: UserStatus.ACTIVE,
            forcePasswordChange: false,
          },
        });
        const { POST } = await loadRouteModule<{
          POST: (request: Request) => Promise<Response>;
        }>("src/app/api/auth/login/route.ts", {
          requestHeaders: {
            "user-agent": "vitest",
            "x-forwarded-for": "127.0.0.1",
          },
        });

        const response = await POST(
          jsonRequest(
            "http://localhost/api/auth/login",
            {
              username: user.username,
              password,
            },
            { method: "POST" },
          ),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          userId: user.id,
          role: "USER",
          forcePasswordChange: false,
        });

        await expect(
          prisma.session.findMany({
            where: { userId: user.id },
          }),
        ).resolves.toHaveLength(1);

        const setCookie = response.headers.get("set-cookie");
        expect(setCookie).toContain("session=");
        expect(setCookie).toContain("HttpOnly");
      });
    });
  });

  it("returns forcePasswordChange on first login", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const password = "FirstLogin123!";
        const passwordHash = await hashPasswordForTest(password);
        const user = await prisma.user.create({
          data: {
            username: "first-login-user",
            passwordHash,
            role: UserRole.USER,
            status: UserStatus.ACTIVE,
            forcePasswordChange: true,
          },
        });
        const { POST } = await loadRouteModule<{
          POST: (request: Request) => Promise<Response>;
        }>("src/app/api/auth/login/route.ts");

        const response = await POST(
          jsonRequest(
            "http://localhost/api/auth/login",
            {
              username: user.username,
              password,
            },
            { method: "POST" },
          ),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          userId: user.id,
          role: "USER",
          forcePasswordChange: true,
        });
      });
    });
  });

  it("refuses login for a disabled account", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const passwordHash = await hashPasswordForTest("DisabledUser123!");
        const user = await prisma.user.create({
          data: {
            username: "disabled-user",
            passwordHash,
            role: UserRole.USER,
            status: UserStatus.DISABLED,
            forcePasswordChange: false,
          },
        });
        const { POST } = await loadRouteModule<{
          POST: (request: Request) => Promise<Response>;
        }>("src/app/api/auth/login/route.ts");

        const response = await POST(
          jsonRequest(
            "http://localhost/api/auth/login",
            {
              username: user.username,
              password: "DisabledUser123!",
            },
            { method: "POST" },
          ),
        );

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toEqual(
          expect.objectContaining({
            error: expect.any(String),
          }),
        );
        await expect(
          prisma.session.count({
            where: { userId: user.id },
          }),
        ).resolves.toBe(0);
      });
    });
  });

  it("revokes the current session on logout", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const passwordHash = await hashPasswordForTest("LogoutUser123!");
        const user = await prisma.user.create({
          data: {
            username: "logout-user",
            passwordHash,
            role: UserRole.USER,
            status: UserStatus.ACTIVE,
            forcePasswordChange: false,
          },
        });
        const session = await insertSessionForUser(prisma, user.id);
        const { POST } = await loadRouteModule<{
          POST: (request: Request) => Promise<Response>;
        }>("src/app/api/auth/logout/route.ts", {
          sessionToken: session.token,
        });

        const response = await POST(
          jsonRequest("http://localhost/api/auth/logout", undefined, {
            method: "POST",
          }),
        );

        expect(response.ok).toBe(true);
        await expect(
          prisma.session.findUniqueOrThrow({
            where: { id: session.sessionId },
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            id: session.sessionId,
            revokedAt: expect.any(Date),
          }),
        );
        expect(response.headers.get("set-cookie")).toContain("session=");
      });
    });
  });

  it("allows a forced-password-change user to set a new password and revokes other sessions", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const initialPassword = "TempPassword123!";
        const nextPassword = "NewPassword456!";
        const passwordHash = await hashPasswordForTest(initialPassword);
        const user = await prisma.user.create({
          data: {
            username: "force-password-user",
            passwordHash,
            role: UserRole.USER,
            status: UserStatus.ACTIVE,
            forcePasswordChange: true,
          },
        });
        const currentSession = await insertSessionForUser(prisma, user.id);
        const otherSession = await insertSessionForUser(prisma, user.id);
        const { POST } = await loadRouteModule<{
          POST: (request: Request) => Promise<Response>;
        }>("src/app/api/auth/force-password/route.ts", {
          sessionToken: currentSession.token,
        });

        const response = await POST(
          jsonRequest(
            "http://localhost/api/auth/force-password",
            {
              password: nextPassword,
            },
            { method: "POST" },
          ),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ ok: true });

        const updatedUser = await prisma.user.findUniqueOrThrow({
          where: { id: user.id },
        });
        expect(updatedUser.forcePasswordChange).toBe(false);

        const { verifyPassword } = await import("../../../src/lib/auth/password");
        await expect(verifyPassword(nextPassword, updatedUser.passwordHash)).resolves.toBe(true);
        await expect(verifyPassword(initialPassword, updatedUser.passwordHash)).resolves.toBe(false);

        await expect(
          prisma.session.findUniqueOrThrow({
            where: { id: currentSession.sessionId },
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            id: currentSession.sessionId,
            revokedAt: null,
          }),
        );
        await expect(
          prisma.session.findUniqueOrThrow({
            where: { id: otherSession.sessionId },
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            id: otherSession.sessionId,
            revokedAt: expect.any(Date),
          }),
        );
      });
    });
  });
});
