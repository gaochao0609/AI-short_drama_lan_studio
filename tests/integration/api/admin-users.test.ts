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

describe("admin user api", () => {
  it("lists only pending account requests", async () => {
    await withTestDatabase(
      async ({ databaseUrl, prisma }) => {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const admin = await prisma.user.update({
              where: { username: "admin-auth-tests" },
              data: { forcePasswordChange: false },
            });
            await prisma.accountRequest.createMany({
              data: [
                {
                  username: "pending-request",
                  displayName: "Pending Request",
                  reason: "Needs access",
                  status: "PENDING",
                },
                {
                  username: "approved-request",
                  displayName: "Approved Request",
                  reason: "Already done",
                  status: "APPROVED",
                  approvedById: admin.id,
                  approvedAt: new Date(),
                },
              ],
            });
            const adminSession = await insertSessionForUser(prisma, admin.id);
            const { GET } = await loadRouteModule<{
              GET: () => Promise<Response>;
            }>("src/app/api/admin/account-requests/route.ts", {
              sessionToken: adminSession.token,
            });

            const response = await GET();

            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual({
              requests: [
                expect.objectContaining({
                  username: "pending-request",
                  status: "PENDING",
                }),
              ],
            });
          },
          {
            DEFAULT_ADMIN_PASSWORD: "AdminPass123!",
            DEFAULT_ADMIN_USERNAME: "admin-auth-tests",
          },
        );
      },
      {
        seed: true,
        seedEnv: {
          DEFAULT_ADMIN_PASSWORD: "AdminPass123!",
          DEFAULT_ADMIN_USERNAME: "admin-auth-tests",
        },
      },
    );
  });

  it("creates a user directly from the admin users api", async () => {
    await withTestDatabase(
      async ({ databaseUrl, prisma }) => {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const admin = await prisma.user.update({
              where: { username: "admin-auth-tests" },
              data: { forcePasswordChange: false },
            });
            const adminSession = await insertSessionForUser(prisma, admin.id);
            const { POST } = await loadRouteModule<{
              POST: (request: Request) => Promise<Response>;
            }>("src/app/api/admin/users/route.ts", {
              sessionToken: adminSession.token,
            });

            const response = await POST(
              jsonRequest(
                "http://localhost/api/admin/users",
                {
                  username: "created-by-admin",
                  role: "USER",
                },
                { method: "POST" },
              ),
            );

            expect(response.status).toBe(201);
            const payload = await response.json();
            expect(payload).toEqual({
              userId: expect.any(String),
              tempPassword: expect.any(String),
            });

            const createdUser = await prisma.user.findUniqueOrThrow({
              where: { id: payload.userId },
            });
            expect(createdUser).toEqual(
              expect.objectContaining({
                username: "created-by-admin",
                role: UserRole.USER,
                status: UserStatus.ACTIVE,
                forcePasswordChange: true,
              }),
            );
          },
          {
            DEFAULT_ADMIN_PASSWORD: "AdminPass123!",
            DEFAULT_ADMIN_USERNAME: "admin-auth-tests",
          },
        );
      },
      {
        seed: true,
        seedEnv: {
          DEFAULT_ADMIN_PASSWORD: "AdminPass123!",
          DEFAULT_ADMIN_USERNAME: "admin-auth-tests",
        },
      },
    );
  });

  it("rejects creating a user when the username is reserved by a pending account request", async () => {
    await withTestDatabase(
      async ({ databaseUrl, prisma }) => {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const admin = await prisma.user.update({
              where: { username: "admin-auth-tests" },
              data: { forcePasswordChange: false },
            });
            await prisma.accountRequest.create({
              data: {
                username: "reserved-pending-user",
                displayName: "Reserved Pending User",
                reason: "Waiting for approval",
                status: "PENDING",
              },
            });
            const adminSession = await insertSessionForUser(prisma, admin.id);
            const { POST } = await loadRouteModule<{
              POST: (request: Request) => Promise<Response>;
            }>("src/app/api/admin/users/route.ts", {
              sessionToken: adminSession.token,
            });

            const response = await POST(
              jsonRequest(
                "http://localhost/api/admin/users",
                {
                  username: "reserved-pending-user",
                  role: "USER",
                },
                { method: "POST" },
              ),
            );

            expect(response.status).toBe(409);
            await expect(response.json()).resolves.toEqual(
              expect.objectContaining({
                error: "Username is reserved by a pending account request",
              }),
            );
            await expect(
              prisma.user.findUnique({
                where: { username: "reserved-pending-user" },
              }),
            ).resolves.toBeNull();
          },
          {
            DEFAULT_ADMIN_PASSWORD: "AdminPass123!",
            DEFAULT_ADMIN_USERNAME: "admin-auth-tests",
          },
        );
      },
      {
        seed: true,
        seedEnv: {
          DEFAULT_ADMIN_PASSWORD: "AdminPass123!",
          DEFAULT_ADMIN_USERNAME: "admin-auth-tests",
        },
      },
    );
  });

  it("creates a user when an admin approves an account request", async () => {
    await withTestDatabase(
      async ({ databaseUrl, prisma }) => {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const admin = await prisma.user.update({
              where: { username: "admin-auth-tests" },
              data: { forcePasswordChange: false },
            });
            const accountRequest = await prisma.accountRequest.create({
              data: {
                username: "approved-user",
                displayName: "Approved User",
                reason: "Review my access",
                status: "PENDING",
              },
            });
            const adminSession = await insertSessionForUser(prisma, admin.id);
            const { POST } = await loadRouteModule<{
              POST: (request: Request) => Promise<Response>;
            }>("src/app/api/admin/account-requests/route.ts", {
              sessionToken: adminSession.token,
            });

            const response = await POST(
              jsonRequest(
                "http://localhost/api/admin/account-requests",
                { requestId: accountRequest.id },
                { method: "POST" },
              ),
            );

            expect(response.status).toBe(200);
            const payload = await response.json();
            expect(payload).toEqual({
              userId: expect.any(String),
              tempPassword: expect.any(String),
            });

            const createdUser = await prisma.user.findUniqueOrThrow({
              where: { id: payload.userId },
            });
            expect(createdUser).toEqual(
              expect.objectContaining({
                username: "approved-user",
                role: UserRole.USER,
                status: UserStatus.ACTIVE,
                forcePasswordChange: true,
              }),
            );
            const { verifyPassword } = await import("../../../src/lib/auth/password");
            await expect(verifyPassword(payload.tempPassword, createdUser.passwordHash)).resolves.toBe(
              true,
            );

            await expect(
              prisma.accountRequest.findUniqueOrThrow({
                where: { id: accountRequest.id },
              }),
            ).resolves.toEqual(
              expect.objectContaining({
                status: "APPROVED",
                approvedById: admin.id,
                approvedAt: expect.any(Date),
              }),
            );
          },
          {
            DEFAULT_ADMIN_PASSWORD: "AdminPass123!",
            DEFAULT_ADMIN_USERNAME: "admin-auth-tests",
          },
        );
      },
      {
        seed: true,
        seedEnv: {
          DEFAULT_ADMIN_PASSWORD: "AdminPass123!",
          DEFAULT_ADMIN_USERNAME: "admin-auth-tests",
        },
      },
    );
  });

  it("disabling a user revokes all existing sessions", async () => {
    await withTestDatabase(
      async ({ databaseUrl, prisma }) => {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const admin = await prisma.user.update({
              where: { username: "admin-auth-tests" },
              data: { forcePasswordChange: false },
            });
            const passwordHash = await hashPasswordForTest("DisableMe123!");
            const user = await prisma.user.create({
              data: {
                username: "disable-target",
                passwordHash,
                role: UserRole.USER,
                status: UserStatus.ACTIVE,
                forcePasswordChange: false,
              },
            });
            const firstSession = await insertSessionForUser(prisma, user.id);
            const secondSession = await insertSessionForUser(prisma, user.id);
            const adminSession = await insertSessionForUser(prisma, admin.id);
            const { PATCH } = await loadRouteModule<{
              PATCH: (request: Request) => Promise<Response>;
            }>("src/app/api/admin/users/route.ts", {
              sessionToken: adminSession.token,
            });

            const response = await PATCH(
              jsonRequest(
                "http://localhost/api/admin/users",
                {
                  userId: user.id,
                  status: "DISABLED",
                },
                { method: "PATCH" },
              ),
            );

            expect(response.status).toBe(200);
            await expect(
              prisma.user.findUniqueOrThrow({
                where: { id: user.id },
              }),
            ).resolves.toEqual(
              expect.objectContaining({
                id: user.id,
                status: UserStatus.DISABLED,
              }),
            );
            await expect(
              prisma.session.findMany({
                where: {
                  id: {
                    in: [firstSession.sessionId, secondSession.sessionId],
                  },
                },
              }),
            ).resolves.toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  id: firstSession.sessionId,
                  revokedAt: expect.any(Date),
                }),
                expect.objectContaining({
                  id: secondSession.sessionId,
                  revokedAt: expect.any(Date),
                }),
              ]),
            );
          },
          {
            DEFAULT_ADMIN_PASSWORD: "AdminPass123!",
            DEFAULT_ADMIN_USERNAME: "admin-auth-tests",
          },
        );
      },
      {
        seed: true,
        seedEnv: {
          DEFAULT_ADMIN_PASSWORD: "AdminPass123!",
          DEFAULT_ADMIN_USERNAME: "admin-auth-tests",
        },
      },
    );
  });

  it("rejects an admin disabling their own account", async () => {
    await withTestDatabase(
      async ({ databaseUrl, prisma }) => {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const admin = await prisma.user.update({
              where: { username: "admin-auth-tests" },
              data: { forcePasswordChange: false },
            });
            const adminSession = await insertSessionForUser(prisma, admin.id);
            const { PATCH } = await loadRouteModule<{
              PATCH: (request: Request) => Promise<Response>;
            }>("src/app/api/admin/users/route.ts", {
              sessionToken: adminSession.token,
            });

            const response = await PATCH(
              jsonRequest(
                "http://localhost/api/admin/users",
                {
                  userId: admin.id,
                  status: "DISABLED",
                },
                { method: "PATCH" },
              ),
            );

            expect(response.status).toBe(409);
            await expect(response.json()).resolves.toEqual(
              expect.objectContaining({
                error: expect.stringContaining("admin"),
              }),
            );
            await expect(
              prisma.user.findUniqueOrThrow({
                where: { id: admin.id },
              }),
            ).resolves.toEqual(
              expect.objectContaining({
                id: admin.id,
                status: UserStatus.ACTIVE,
              }),
            );
          },
          {
            DEFAULT_ADMIN_PASSWORD: "AdminPass123!",
            DEFAULT_ADMIN_USERNAME: "admin-auth-tests",
          },
        );
      },
      {
        seed: true,
        seedEnv: {
          DEFAULT_ADMIN_PASSWORD: "AdminPass123!",
          DEFAULT_ADMIN_USERNAME: "admin-auth-tests",
        },
      },
    );
  });

  it("rejects disabling the last active admin", async () => {
    await withTestDatabase(
      async ({ databaseUrl, prisma }) => {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const actingAdmin = await prisma.user.update({
              where: { username: "admin-auth-tests" },
              data: { forcePasswordChange: false },
            });
            const targetPasswordHash = await hashPasswordForTest("TargetAdmin123!");
            const targetAdmin = await prisma.user.create({
              data: {
                username: "target-admin",
                passwordHash: targetPasswordHash,
                role: UserRole.ADMIN,
                status: UserStatus.ACTIVE,
                forcePasswordChange: false,
              },
            });
            await prisma.user.update({
              where: { id: actingAdmin.id },
              data: { status: UserStatus.DISABLED },
            });
            const adminSession = await insertSessionForUser(prisma, actingAdmin.id);
            const { PATCH } = await loadRouteModule<{
              PATCH: (request: Request) => Promise<Response>;
            }>("src/app/api/admin/users/route.ts", {
              sessionToken: adminSession.token,
            });

            const response = await PATCH(
              jsonRequest(
                "http://localhost/api/admin/users",
                {
                  userId: targetAdmin.id,
                  status: "DISABLED",
                },
                { method: "PATCH" },
              ),
            );

            expect(response.status).toBe(409);
            await expect(response.json()).resolves.toEqual(
              expect.objectContaining({
                error: expect.stringContaining("last active admin"),
              }),
            );
            await expect(
              prisma.user.findUniqueOrThrow({
                where: { id: targetAdmin.id },
              }),
            ).resolves.toEqual(
              expect.objectContaining({
                id: targetAdmin.id,
                status: UserStatus.ACTIVE,
              }),
            );
          },
          {
            DEFAULT_ADMIN_PASSWORD: "AdminPass123!",
            DEFAULT_ADMIN_USERNAME: "admin-auth-tests",
          },
        );
      },
      {
        seed: true,
        seedEnv: {
          DEFAULT_ADMIN_PASSWORD: "AdminPass123!",
          DEFAULT_ADMIN_USERNAME: "admin-auth-tests",
        },
      },
    );
  });

  it("resetting a password revokes existing sessions and forces password change", async () => {
    await withTestDatabase(
      async ({ databaseUrl, prisma }) => {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const admin = await prisma.user.update({
              where: { username: "admin-auth-tests" },
              data: { forcePasswordChange: false },
            });
            const passwordHash = await hashPasswordForTest("ResetTarget123!");
            const user = await prisma.user.create({
              data: {
                username: "reset-target",
                passwordHash,
                role: UserRole.USER,
                status: UserStatus.ACTIVE,
                forcePasswordChange: false,
              },
            });
            const existingSession = await insertSessionForUser(prisma, user.id);
            const adminSession = await insertSessionForUser(prisma, admin.id);
            const { POST } = await loadRouteModule<{
              POST: (
                request: Request,
                context: { params: Promise<{ userId: string }> | { userId: string } },
              ) => Promise<Response>;
            }>("src/app/api/admin/users/[userId]/reset-password/route.ts", {
              sessionToken: adminSession.token,
            });

            const response = await POST(
              jsonRequest(
                `http://localhost/api/admin/users/${user.id}/reset-password`,
                undefined,
                { method: "POST" },
              ),
              { params: { userId: user.id } },
            );

            expect(response.status).toBe(200);
            const payload = await response.json();
            expect(payload).toEqual({
              tempPassword: expect.any(String),
            });

            const updatedUser = await prisma.user.findUniqueOrThrow({
              where: { id: user.id },
            });
            expect(updatedUser).toEqual(
              expect.objectContaining({
                id: user.id,
                status: UserStatus.ACTIVE,
                forcePasswordChange: true,
              }),
            );

            const { verifyPassword } = await import("../../../src/lib/auth/password");
            await expect(verifyPassword(payload.tempPassword, updatedUser.passwordHash)).resolves.toBe(
              true,
            );
            await expect(
              prisma.session.findUniqueOrThrow({
                where: { id: existingSession.sessionId },
              }),
            ).resolves.toEqual(
              expect.objectContaining({
                id: existingSession.sessionId,
                revokedAt: expect.any(Date),
              }),
            );
          },
          {
            DEFAULT_ADMIN_PASSWORD: "AdminPass123!",
            DEFAULT_ADMIN_USERNAME: "admin-auth-tests",
          },
        );
      },
      {
        seed: true,
        seedEnv: {
          DEFAULT_ADMIN_PASSWORD: "AdminPass123!",
          DEFAULT_ADMIN_USERNAME: "admin-auth-tests",
        },
      },
    );
  });

  it("resetting a disabled user password keeps the account disabled", async () => {
    await withTestDatabase(
      async ({ databaseUrl, prisma }) => {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const admin = await prisma.user.update({
              where: { username: "admin-auth-tests" },
              data: { forcePasswordChange: false },
            });
            const passwordHash = await hashPasswordForTest("DisabledReset123!");
            const user = await prisma.user.create({
              data: {
                username: "disabled-reset-target",
                passwordHash,
                role: UserRole.USER,
                status: UserStatus.DISABLED,
                forcePasswordChange: false,
              },
            });
            const existingSession = await insertSessionForUser(prisma, user.id);
            const adminSession = await insertSessionForUser(prisma, admin.id);
            const { POST } = await loadRouteModule<{
              POST: (
                request: Request,
                context: { params: Promise<{ userId: string }> | { userId: string } },
              ) => Promise<Response>;
            }>("src/app/api/admin/users/[userId]/reset-password/route.ts", {
              sessionToken: adminSession.token,
            });

            const response = await POST(
              jsonRequest(
                `http://localhost/api/admin/users/${user.id}/reset-password`,
                undefined,
                { method: "POST" },
              ),
              { params: { userId: user.id } },
            );

            expect(response.status).toBe(200);
            const payload = await response.json();
            expect(payload).toEqual({
              tempPassword: expect.any(String),
            });

            await expect(
              prisma.user.findUniqueOrThrow({
                where: { id: user.id },
              }),
            ).resolves.toEqual(
              expect.objectContaining({
                id: user.id,
                status: UserStatus.DISABLED,
                forcePasswordChange: true,
              }),
            );
            await expect(
              prisma.session.findUniqueOrThrow({
                where: { id: existingSession.sessionId },
              }),
            ).resolves.toEqual(
              expect.objectContaining({
                id: existingSession.sessionId,
                revokedAt: expect.any(Date),
              }),
            );
          },
          {
            DEFAULT_ADMIN_PASSWORD: "AdminPass123!",
            DEFAULT_ADMIN_USERNAME: "admin-auth-tests",
          },
        );
      },
      {
        seed: true,
        seedEnv: {
          DEFAULT_ADMIN_PASSWORD: "AdminPass123!",
          DEFAULT_ADMIN_USERNAME: "admin-auth-tests",
        },
      },
    );
  });
});
