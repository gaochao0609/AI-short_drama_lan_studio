import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  TaskStatus,
  TaskType,
  UserRole,
  UserStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
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

async function withAdminQueueTestEnv<T>(
  databaseUrl: string,
  callback: () => Promise<T>,
  envOverrides: Record<string, string> = {},
) {
  return withApiTestEnv(
    databaseUrl,
    async () => {
      const [{ closeQueues }, { connection }] = await Promise.all([
        import("@/lib/queues"),
        import("@/lib/redis"),
      ]);

      await connection.flushdb();

      try {
        return await callback();
      } finally {
        await closeQueues();
        await connection.quit();
      }
    },
    {
      REDIS_URL: "redis://127.0.0.1:6379/15",
      ...envOverrides,
    },
  );
}

async function createActiveUser(prisma: PrismaClient, username: string, role = UserRole.USER) {
  const passwordHash = await hashPasswordForTest("AdminTasks123!");

  return prisma.user.create({
    data: {
      username,
      passwordHash,
      role,
      status: UserStatus.ACTIVE,
      forcePasswordChange: false,
    },
  });
}

async function createTaskFixture(
  prisma: PrismaClient,
  input: {
    ownerId: string;
    createdById?: string;
    title: string;
    type: TaskType;
    status: TaskStatus;
    inputJson?: Prisma.InputJsonValue;
    outputJson?: Prisma.InputJsonValue | Prisma.NullTypes.DbNull;
    errorText?: string | null;
    cancelRequestedAt?: Date | null;
    startedAt?: Date | null;
    finishedAt?: Date | null;
    taskSteps?: Array<{
      stepKey?: string;
      status: TaskStatus;
      retryCount?: number;
      inputJson?: Prisma.InputJsonValue;
      outputJson?: Prisma.InputJsonValue | Prisma.NullTypes.DbNull;
      errorText?: string | null;
      log?: string | null;
      createdAt?: Date;
    }>;
  },
) {
  const project = await prisma.project.create({
    data: {
      ownerId: input.ownerId,
      title: input.title,
    },
  });

  return prisma.task.create({
    data: {
      projectId: project.id,
      createdById: input.createdById ?? input.ownerId,
      type: input.type,
      status: input.status,
      inputJson:
        input.inputJson ??
        ({
          projectId: project.id,
          prompt: `${input.title} prompt`,
          userId: input.ownerId,
        } as Prisma.InputJsonValue),
      outputJson: input.outputJson,
      errorText: input.errorText ?? null,
      cancelRequestedAt: input.cancelRequestedAt ?? null,
      startedAt: input.startedAt ?? null,
      finishedAt: input.finishedAt ?? null,
      steps: input.taskSteps
        ? {
            create: input.taskSteps.map((step) => ({
              stepKey: step.stepKey ?? input.type,
              status: step.status,
              retryCount: step.retryCount ?? 0,
              inputJson: step.inputJson ?? ({ attempt: step.retryCount ?? 0 } as Prisma.InputJsonValue),
              outputJson: step.outputJson,
              errorText: step.errorText ?? null,
              log: step.log ?? null,
              createdAt: step.createdAt,
            })),
          }
        : undefined,
    },
    include: {
      steps: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });
}

async function createFileWithAge(filePath: string, bytes: Uint8Array, modifiedAt: Date) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
  await import("node:fs/promises").then(({ utimes }) => utimes(filePath, modifiedAt, modifiedAt));
}

describe("admin tasks and storage api", () => {
  it("lists failed tasks for admins and rejects normal users", async () => {
    await withTestDatabase(
      async ({ databaseUrl, prisma }) => {
        const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-admin-tasks-storage-"));

        try {
          await withAdminQueueTestEnv(
            databaseUrl,
            async () => {
              const admin = await prisma.user.update({
                where: { username: "admin-auth-tests" },
                data: { forcePasswordChange: false },
              });
              const adminSession = await insertSessionForUser(prisma, admin.id);
              const user = await createActiveUser(prisma, "admin-tasks-list-user");
              const userSession = await insertSessionForUser(prisma, user.id);
              const failedTask = await createTaskFixture(prisma, {
                ownerId: user.id,
                title: "Failed task project",
                type: TaskType.IMAGE,
                status: TaskStatus.FAILED,
                errorText: "provider timeout",
                finishedAt: new Date(),
                taskSteps: [
                  {
                    status: TaskStatus.FAILED,
                    retryCount: 1,
                    errorText: "provider timeout",
                  },
                ],
              });
              await createTaskFixture(prisma, {
                ownerId: user.id,
                title: "Succeeded task project",
                type: TaskType.VIDEO,
                status: TaskStatus.SUCCEEDED,
                finishedAt: new Date(),
                taskSteps: [
                  {
                    status: TaskStatus.SUCCEEDED,
                    retryCount: 0,
                    outputJson: { ok: true } as Prisma.InputJsonValue,
                  },
                ],
              });

              const { GET: getAsAdmin } = await loadRouteModule<{
                GET: (request: Request) => Promise<Response>;
              }>("src/app/api/admin/tasks/route.ts", {
                sessionToken: adminSession.token,
              });
              const adminResponse = await getAsAdmin(new Request("http://localhost/api/admin/tasks"));

              expect(adminResponse.status).toBe(200);
              await expect(adminResponse.json()).resolves.toEqual({
                tasks: expect.arrayContaining([
                  expect.objectContaining({
                    id: failedTask.id,
                    type: TaskType.IMAGE,
                    status: TaskStatus.FAILED,
                    errorText: "provider timeout",
                    retryHistory: [
                      expect.objectContaining({
                        status: TaskStatus.FAILED,
                        retryCount: 1,
                        errorText: "provider timeout",
                      }),
                    ],
                  }),
                ]),
              });

              vi.resetModules();
              const { GET: getAsUser } = await loadRouteModule<{
                GET: (request: Request) => Promise<Response>;
              }>("src/app/api/admin/tasks/route.ts", {
                sessionToken: userSession.token,
              });
              const forbiddenResponse = await getAsUser(new Request("http://localhost/api/admin/tasks"));

              expect(forbiddenResponse.status).toBe(403);
              await expect(forbiddenResponse.json()).resolves.toEqual({
                error: "Forbidden",
              });
            },
            {
              STORAGE_ROOT: storageRoot,
            },
          );
        } finally {
          await rm(storageRoot, { recursive: true, force: true });
        }
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

  it("manually retries a failed task by enqueueing a new task step", async () => {
    await withTestDatabase(
      async ({ databaseUrl, prisma }) => {
        const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-admin-retry-storage-"));

        try {
          await withAdminQueueTestEnv(
            databaseUrl,
            async () => {
              const admin = await prisma.user.update({
                where: { username: "admin-auth-tests" },
                data: { forcePasswordChange: false },
              });
              const adminSession = await insertSessionForUser(prisma, admin.id);
              const user = await createActiveUser(prisma, "admin-retry-target");
              const task = await createTaskFixture(prisma, {
                ownerId: user.id,
                title: "Retry task project",
                type: TaskType.IMAGE,
                status: TaskStatus.FAILED,
                errorText: "transient upstream failure",
                finishedAt: new Date(),
                taskSteps: [
                  {
                    status: TaskStatus.FAILED,
                    retryCount: 2,
                    errorText: "transient upstream failure",
                  },
                ],
              });
              const { queues } = await import("@/lib/queues");
              const { POST } = await loadRouteModule<{
                POST: (
                  request: Request,
                  context: { params: Promise<{ taskId: string }> | { taskId: string } },
                ) => Promise<Response>;
              }>("src/app/api/admin/tasks/[taskId]/retry/route.ts", {
                sessionToken: adminSession.token,
              });

              const response = await POST(
                jsonRequest(`http://localhost/api/admin/tasks/${task.id}/retry`, undefined, { method: "POST" }),
                { params: { taskId: task.id } },
              );

              expect(response.status).toBe(202);
              await expect(response.json()).resolves.toEqual(
                expect.objectContaining({
                  taskId: task.id,
                  status: TaskStatus.QUEUED,
                  queueName: "image-queue",
                  jobId: expect.any(String),
                }),
              );

              const updatedTask = await prisma.task.findUniqueOrThrow({
                where: { id: task.id },
                include: {
                  steps: {
                    orderBy: {
                      createdAt: "asc",
                    },
                  },
                },
              });

              expect(updatedTask.status).toBe(TaskStatus.QUEUED);
              expect(updatedTask.errorText).toBeNull();
              expect(updatedTask.cancelRequestedAt).toBeNull();
              expect(updatedTask.steps).toHaveLength(2);
              expect(updatedTask.steps.at(-1)).toEqual(
                expect.objectContaining({
                  status: TaskStatus.QUEUED,
                  stepKey: TaskType.IMAGE,
                  retryCount: 0,
                }),
              );

              const latestStep = updatedTask.steps.at(-1);
              expect(latestStep).toBeDefined();
              const queuedJob = await queues.image.getJob(latestStep!.id);
              expect(queuedJob?.id).toBe(latestStep!.id);
            },
            {
              STORAGE_ROOT: storageRoot,
            },
          );
        } finally {
          await rm(storageRoot, { recursive: true, force: true });
        }
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

  it("allows only one admin retry to win when two retry requests race", async () => {
    await withTestDatabase(
      async ({ databaseUrl, prisma }) => {
        const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-admin-retry-race-storage-"));

        try {
          await withAdminQueueTestEnv(
            databaseUrl,
            async () => {
              const admin = await prisma.user.update({
                where: { username: "admin-auth-tests" },
                data: { forcePasswordChange: false },
              });
              const adminSession = await insertSessionForUser(prisma, admin.id);
              const user = await createActiveUser(prisma, "admin-retry-race-target");
              const task = await createTaskFixture(prisma, {
                ownerId: user.id,
                title: "Retry race project",
                type: TaskType.IMAGE,
                status: TaskStatus.FAILED,
                errorText: "temporary error",
                finishedAt: new Date(),
                taskSteps: [
                  {
                    status: TaskStatus.FAILED,
                    retryCount: 1,
                    errorText: "temporary error",
                  },
                ],
              });

              const [{ POST }, { prisma: runtimePrisma }, { queues }] = await Promise.all([
                loadRouteModule<{
                  POST: (
                    request: Request,
                    context: { params: Promise<{ taskId: string }> | { taskId: string } },
                  ) => Promise<Response>;
                }>("src/app/api/admin/tasks/[taskId]/retry/route.ts", {
                  sessionToken: adminSession.token,
                }),
                import("@/lib/db"),
                import("@/lib/queues"),
              ]);

              const originalFindUnique = runtimePrisma.task.findUnique.bind(runtimePrisma.task);
              let releaseValidationReads: (() => void) | null = null;
              const validationReadsReached = new Promise<void>((resolve) => {
                releaseValidationReads = resolve;
              });
              let heldValidationReads = 0;
              const findUniqueSpy = vi
                .spyOn(runtimePrisma.task, "findUnique")
                .mockImplementation(
                  (async (...args: Parameters<typeof runtimePrisma.task.findUnique>) => {
                    const query = args[0] as
                      | { where?: { id?: string }; select?: { inputJson?: boolean } }
                      | undefined;
                    const isValidationRead =
                      query?.where?.id === task.id && query?.select?.inputJson === true;

                    if (isValidationRead) {
                      heldValidationReads += 1;

                      if (heldValidationReads === 2) {
                        releaseValidationReads?.();
                      }

                      await validationReadsReached;
                    }

                    return originalFindUnique(...args);
                  }) as unknown as typeof runtimePrisma.task.findUnique,
                );

              try {
                const [firstResponse, secondResponse] = await Promise.all([
                  POST(
                    jsonRequest(`http://localhost/api/admin/tasks/${task.id}/retry`, undefined, {
                      method: "POST",
                    }),
                    { params: { taskId: task.id } },
                  ),
                  POST(
                    jsonRequest(`http://localhost/api/admin/tasks/${task.id}/retry`, undefined, {
                      method: "POST",
                    }),
                    { params: { taskId: task.id } },
                  ),
                ]);

                const statuses = [firstResponse.status, secondResponse.status].sort((left, right) => {
                  return left - right;
                });
                expect(statuses).toEqual([202, 409]);

                const failedResponse =
                  firstResponse.status === 409 ? firstResponse : secondResponse;
                await expect(failedResponse.json()).resolves.toEqual({
                  error: "Task retry is already in progress",
                });

                const updatedTask = await prisma.task.findUniqueOrThrow({
                  where: { id: task.id },
                  include: {
                    steps: {
                      orderBy: {
                        createdAt: "asc",
                      },
                    },
                  },
                });

                expect(updatedTask.status).toBe(TaskStatus.QUEUED);
                expect(updatedTask.steps).toHaveLength(2);

                const queuedSteps = updatedTask.steps.filter((step) => step.status === TaskStatus.QUEUED);
                expect(queuedSteps).toHaveLength(1);
                await expect(queues.image.getJob(queuedSteps[0].id)).resolves.toBeTruthy();
              } finally {
                findUniqueSpy.mockRestore();
              }
            },
            {
              STORAGE_ROOT: storageRoot,
            },
          );
        } finally {
          await rm(storageRoot, { recursive: true, force: true });
        }
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

  it("cancels queued jobs immediately and marks running jobs as cancel requested", async () => {
    await withTestDatabase(
      async ({ databaseUrl, prisma }) => {
        const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-admin-cancel-storage-"));

        try {
          await withAdminQueueTestEnv(
            databaseUrl,
            async () => {
              const admin = await prisma.user.update({
                where: { username: "admin-auth-tests" },
                data: { forcePasswordChange: false },
              });
              const adminSession = await insertSessionForUser(prisma, admin.id);
              const user = await createActiveUser(prisma, "admin-cancel-target");
              const queuedTask = await createTaskFixture(prisma, {
                ownerId: user.id,
                title: "Queued task project",
                type: TaskType.VIDEO,
                status: TaskStatus.QUEUED,
                taskSteps: [
                  {
                    status: TaskStatus.QUEUED,
                    retryCount: 0,
                  },
                ],
              });
              const runningTask = await createTaskFixture(prisma, {
                ownerId: user.id,
                title: "Running task project",
                type: TaskType.STORYBOARD,
                status: TaskStatus.RUNNING,
                startedAt: new Date(),
                taskSteps: [
                  {
                    status: TaskStatus.RUNNING,
                    retryCount: 0,
                  },
                ],
              });

              const { queues } = await import("@/lib/queues");
              const queuedStep = queuedTask.steps[0];
              await queues.video.add(
                TaskType.VIDEO,
                {
                  taskId: queuedTask.id,
                  taskStepId: queuedStep.id,
                  traceId: "cancel-trace",
                  payload: queuedTask.inputJson,
                },
                {
                  attempts: 2,
                  jobId: queuedStep.id,
                  removeOnComplete: true,
                  removeOnFail: false,
                },
              );

              const { POST } = await loadRouteModule<{
                POST: (
                  request: Request,
                  context: { params: Promise<{ taskId: string }> | { taskId: string } },
                ) => Promise<Response>;
              }>("src/app/api/admin/tasks/[taskId]/cancel/route.ts", {
                sessionToken: adminSession.token,
              });

              const cancelQueuedResponse = await POST(
                jsonRequest(`http://localhost/api/admin/tasks/${queuedTask.id}/cancel`, undefined, {
                  method: "POST",
                }),
                { params: { taskId: queuedTask.id } },
              );

              expect(cancelQueuedResponse.status).toBe(200);
              await expect(cancelQueuedResponse.json()).resolves.toEqual(
                expect.objectContaining({
                  taskId: queuedTask.id,
                  status: TaskStatus.CANCELED,
                }),
              );
              await expect(queues.video.getJob(queuedStep.id)).resolves.toBeUndefined();
              await expect(
                prisma.task.findUniqueOrThrow({
                  where: { id: queuedTask.id },
                }),
              ).resolves.toEqual(
                expect.objectContaining({
                  id: queuedTask.id,
                  status: TaskStatus.CANCELED,
                  cancelRequestedAt: expect.any(Date),
                  finishedAt: expect.any(Date),
                }),
              );

              const cancelRunningResponse = await POST(
                jsonRequest(`http://localhost/api/admin/tasks/${runningTask.id}/cancel`, undefined, {
                  method: "POST",
                }),
                { params: { taskId: runningTask.id } },
              );

              expect(cancelRunningResponse.status).toBe(202);
              await expect(cancelRunningResponse.json()).resolves.toEqual(
                expect.objectContaining({
                  taskId: runningTask.id,
                  status: TaskStatus.RUNNING,
                  cancelRequestedAt: expect.any(String),
                }),
              );
              await expect(
                prisma.task.findUniqueOrThrow({
                  where: { id: runningTask.id },
                }),
              ).resolves.toEqual(
                expect.objectContaining({
                  id: runningTask.id,
                  status: TaskStatus.RUNNING,
                  cancelRequestedAt: expect.any(Date),
                }),
              );
            },
            {
              STORAGE_ROOT: storageRoot,
            },
          );
        } finally {
          await rm(storageRoot, { recursive: true, force: true });
        }
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

  it("falls back to cancel request mode when queued job removal loses a lock race", async () => {
    await withTestDatabase(
      async ({ databaseUrl, prisma }) => {
        const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-admin-cancel-race-storage-"));

        try {
          await withAdminQueueTestEnv(
            databaseUrl,
            async () => {
              const admin = await prisma.user.update({
                where: { username: "admin-auth-tests" },
                data: { forcePasswordChange: false },
              });
              const adminSession = await insertSessionForUser(prisma, admin.id);
              const user = await createActiveUser(prisma, "admin-cancel-race-target");
              const queuedTask = await createTaskFixture(prisma, {
                ownerId: user.id,
                title: "Queued task race project",
                type: TaskType.VIDEO,
                status: TaskStatus.QUEUED,
                taskSteps: [
                  {
                    status: TaskStatus.QUEUED,
                    retryCount: 0,
                  },
                ],
              });

              const { queues } = await import("@/lib/queues");
              const getJobSpy = vi.spyOn(queues.video, "getJob").mockResolvedValue({
                remove: vi.fn().mockRejectedValue(new Error("Job is locked")),
              } as never);
              const { POST } = await loadRouteModule<{
                POST: (
                  request: Request,
                  context: { params: Promise<{ taskId: string }> | { taskId: string } },
                ) => Promise<Response>;
              }>("src/app/api/admin/tasks/[taskId]/cancel/route.ts", {
                sessionToken: adminSession.token,
              });

              try {
                const response = await POST(
                  jsonRequest(`http://localhost/api/admin/tasks/${queuedTask.id}/cancel`, undefined, {
                    method: "POST",
                  }),
                  { params: { taskId: queuedTask.id } },
                );

                expect(response.status).toBe(202);
                await expect(response.json()).resolves.toEqual(
                  expect.objectContaining({
                    taskId: queuedTask.id,
                    status: TaskStatus.QUEUED,
                    cancelRequestedAt: expect.any(String),
                  }),
                );
                await expect(
                  prisma.task.findUniqueOrThrow({
                    where: { id: queuedTask.id },
                  }),
                ).resolves.toEqual(
                  expect.objectContaining({
                    id: queuedTask.id,
                    status: TaskStatus.QUEUED,
                    cancelRequestedAt: expect.any(Date),
                  }),
                );
              } finally {
                getJobSpy.mockRestore();
              }
            },
            {
              STORAGE_ROOT: storageRoot,
            },
          );
        } finally {
          await rm(storageRoot, { recursive: true, force: true });
        }
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

  it("does not write stale cancelRequestedAt when queued removal loses a race to task completion", async () => {
    await withTestDatabase(
      async ({ databaseUrl, prisma }) => {
        const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-admin-cancel-finished-queued-"));

        try {
          await withAdminQueueTestEnv(
            databaseUrl,
            async () => {
              const admin = await prisma.user.update({
                where: { username: "admin-auth-tests" },
                data: { forcePasswordChange: false },
              });
              const adminSession = await insertSessionForUser(prisma, admin.id);
              const user = await createActiveUser(prisma, "admin-cancel-finished-queued-target");
              const queuedTask = await createTaskFixture(prisma, {
                ownerId: user.id,
                title: "Queued completion race project",
                type: TaskType.VIDEO,
                status: TaskStatus.QUEUED,
                taskSteps: [
                  {
                    status: TaskStatus.QUEUED,
                    retryCount: 0,
                  },
                ],
              });

              const { queues } = await import("@/lib/queues");
              const getJobSpy = vi.spyOn(queues.video, "getJob").mockResolvedValue({
                remove: vi.fn().mockImplementation(async () => {
                  await prisma.task.update({
                    where: { id: queuedTask.id },
                    data: {
                      status: TaskStatus.SUCCEEDED,
                      finishedAt: new Date(),
                      errorText: null,
                    },
                  });
                  throw new Error("Job is locked");
                }),
              } as never);
              const { POST } = await loadRouteModule<{
                POST: (
                  request: Request,
                  context: { params: Promise<{ taskId: string }> | { taskId: string } },
                ) => Promise<Response>;
              }>("src/app/api/admin/tasks/[taskId]/cancel/route.ts", {
                sessionToken: adminSession.token,
              });

              try {
                const response = await POST(
                  jsonRequest(`http://localhost/api/admin/tasks/${queuedTask.id}/cancel`, undefined, {
                    method: "POST",
                  }),
                  { params: { taskId: queuedTask.id } },
                );

                expect(response.status).toBe(200);
                await expect(response.json()).resolves.toEqual({
                  taskId: queuedTask.id,
                  status: TaskStatus.SUCCEEDED,
                  cancelRequestedAt: null,
                });
                await expect(
                  prisma.task.findUniqueOrThrow({
                    where: { id: queuedTask.id },
                  }),
                ).resolves.toEqual(
                  expect.objectContaining({
                    id: queuedTask.id,
                    status: TaskStatus.SUCCEEDED,
                    cancelRequestedAt: null,
                  }),
                );
              } finally {
                getJobSpy.mockRestore();
              }
            },
            {
              STORAGE_ROOT: storageRoot,
            },
          );
        } finally {
          await rm(storageRoot, { recursive: true, force: true });
        }
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

  it("does not write stale cancelRequestedAt when a running task finishes before cancel is stored", async () => {
    await withTestDatabase(
      async ({ databaseUrl, prisma }) => {
        const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-admin-cancel-finished-running-"));

        try {
          await withAdminQueueTestEnv(
            databaseUrl,
            async () => {
              const admin = await prisma.user.update({
                where: { username: "admin-auth-tests" },
                data: { forcePasswordChange: false },
              });
              const adminSession = await insertSessionForUser(prisma, admin.id);
              const user = await createActiveUser(prisma, "admin-cancel-finished-running-target");
              const runningTask = await createTaskFixture(prisma, {
                ownerId: user.id,
                title: "Running completion race project",
                type: TaskType.STORYBOARD,
                status: TaskStatus.RUNNING,
                startedAt: new Date(),
                taskSteps: [
                  {
                    status: TaskStatus.RUNNING,
                    retryCount: 0,
                  },
                ],
              });

              const { prisma: runtimePrisma } = await import("@/lib/db");
              const originalFindUnique = runtimePrisma.task.findUnique.bind(runtimePrisma.task);
              let injectedCompletion = false;
              const findUniqueSpy = vi
                .spyOn(runtimePrisma.task, "findUnique")
                .mockImplementation(
                  (async (...args: Parameters<typeof runtimePrisma.task.findUnique>) => {
                    const query = args[0] as
                      | {
                          where?: { id?: string };
                          select?: { steps?: unknown; cancelRequestedAt?: boolean };
                        }
                      | undefined;
                    const isInitialCancelRead =
                      !injectedCompletion &&
                      query?.where?.id === runningTask.id &&
                      query?.select?.steps !== undefined &&
                      query?.select?.cancelRequestedAt === true;
                    const result = await originalFindUnique(...args);

                    if (isInitialCancelRead) {
                      injectedCompletion = true;
                      await prisma.task.update({
                        where: { id: runningTask.id },
                        data: {
                          status: TaskStatus.SUCCEEDED,
                          finishedAt: new Date(),
                          errorText: null,
                        },
                      });
                    }

                    return result;
                  }) as unknown as typeof runtimePrisma.task.findUnique,
                );
              const { POST } = await loadRouteModule<{
                POST: (
                  request: Request,
                  context: { params: Promise<{ taskId: string }> | { taskId: string } },
                ) => Promise<Response>;
              }>("src/app/api/admin/tasks/[taskId]/cancel/route.ts", {
                sessionToken: adminSession.token,
              });

              try {
                const response = await POST(
                  jsonRequest(`http://localhost/api/admin/tasks/${runningTask.id}/cancel`, undefined, {
                    method: "POST",
                  }),
                  { params: { taskId: runningTask.id } },
                );

                expect(response.status).toBe(200);
                await expect(response.json()).resolves.toEqual({
                  taskId: runningTask.id,
                  status: TaskStatus.SUCCEEDED,
                  cancelRequestedAt: null,
                });
                await expect(
                  prisma.task.findUniqueOrThrow({
                    where: { id: runningTask.id },
                  }),
                ).resolves.toEqual(
                  expect.objectContaining({
                    id: runningTask.id,
                    status: TaskStatus.SUCCEEDED,
                    cancelRequestedAt: null,
                  }),
                );
              } finally {
                findUniqueSpy.mockRestore();
              }
            },
            {
              STORAGE_ROOT: storageRoot,
            },
          );
        } finally {
          await rm(storageRoot, { recursive: true, force: true });
        }
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

  it("returns zero storage usage instead of failing when STORAGE_ROOT does not exist yet", async () => {
    await withTestDatabase(
      async ({ databaseUrl, prisma }) => {
        const baseRoot = await mkdtemp(path.join(os.tmpdir(), "lan-admin-missing-root-"));
        const missingStorageRoot = path.join(baseRoot, "missing-storage-root");

        try {
          await withAdminQueueTestEnv(
            databaseUrl,
            async () => {
              const admin = await prisma.user.update({
                where: { username: "admin-auth-tests" },
                data: { forcePasswordChange: false },
              });
              const adminSession = await insertSessionForUser(prisma, admin.id);
              const { GET } = await loadRouteModule<{
                GET: () => Promise<Response>;
              }>("src/app/api/admin/storage/route.ts", {
                sessionToken: adminSession.token,
              });

              const response = await GET();

              expect(response.status).toBe(200);
              await expect(response.json()).resolves.toEqual(
                expect.objectContaining({
                  uploadsBytes: 0,
                  imagesBytes: 0,
                  videosBytes: 0,
                  exportsBytes: 0,
                  totalBytes: expect.any(Number),
                  freeBytes: expect.any(Number),
                }),
              );
            },
            {
              STORAGE_ROOT: missingStorageRoot,
            },
          );
        } finally {
          await rm(baseRoot, { recursive: true, force: true });
        }
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

  it("reports storage usage and cleans up unreferenced files older than 30 days", async () => {
    await withTestDatabase(
      async ({ databaseUrl, prisma }) => {
        const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-admin-storage-"));

        try {
          await withAdminQueueTestEnv(
            databaseUrl,
            async () => {
              const admin = await prisma.user.update({
                where: { username: "admin-auth-tests" },
                data: { forcePasswordChange: false },
              });
              const adminSession = await insertSessionForUser(prisma, admin.id);
              const owner = await createActiveUser(prisma, "admin-storage-owner");
              const project = await prisma.project.create({
                data: {
                  ownerId: owner.id,
                  title: "Storage project",
                },
              });

              const now = new Date();
              const oldDate = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
              const uploadsPath = path.join(storageRoot, "uploads", project.id, "task-a", "source.txt");
              const imagesPath = path.join(storageRoot, "generated-images", project.id, "task-b", "cache.png");
              const videosPath = path.join(storageRoot, "generated-videos", project.id, "task-c", "preview.mp4");
              const exportsPath = path.join(storageRoot, "exports", project.id, "master.zip");
              const referencedOldImagePath = path.join(
                storageRoot,
                "generated-images",
                project.id,
                "task-d",
                "keep.png",
              );
              const persistedImageAssetPath = path.join(
                storageRoot,
                "assets",
                project.id,
                "references",
                "persisted-reference.png",
              );
              const persistedVideoAssetPath = path.join(
                storageRoot,
                "assets",
                project.id,
                "task-e",
                "persisted-output.mp4",
              );

              await createFileWithAge(uploadsPath, Buffer.from("upload-data"), now);
              await createFileWithAge(imagesPath, Buffer.from("image-cache"), oldDate);
              await createFileWithAge(videosPath, Buffer.from("video-cache"), oldDate);
              await createFileWithAge(exportsPath, Buffer.from("export-data"), now);
              await createFileWithAge(referencedOldImagePath, Buffer.from("keep-image"), oldDate);
              await createFileWithAge(persistedImageAssetPath, Buffer.from("asset-image"), now);
              await createFileWithAge(persistedVideoAssetPath, Buffer.from("asset-video"), now);

              await prisma.asset.create({
                data: {
                  projectId: project.id,
                  taskId: null,
                  kind: "image_generated",
                  storagePath: path.relative(storageRoot, referencedOldImagePath),
                  originalName: "keep.png",
                  mimeType: "image/png",
                  sizeBytes: Buffer.byteLength("keep-image"),
                },
              });
              await prisma.asset.create({
                data: {
                  projectId: project.id,
                  taskId: null,
                  kind: "image_reference",
                  storagePath: path.relative(storageRoot, persistedImageAssetPath),
                  originalName: "persisted-reference.png",
                  mimeType: "image/png",
                  sizeBytes: Buffer.byteLength("asset-image"),
                },
              });
              await prisma.asset.create({
                data: {
                  projectId: project.id,
                  taskId: null,
                  kind: "video_generated",
                  storagePath: path.relative(storageRoot, persistedVideoAssetPath),
                  originalName: "persisted-output.mp4",
                  mimeType: "video/mp4",
                  sizeBytes: Buffer.byteLength("asset-video"),
                },
              });

              const { GET } = await loadRouteModule<{
                GET: () => Promise<Response>;
              }>("src/app/api/admin/storage/route.ts", {
                sessionToken: adminSession.token,
              });
              const statsResponse = await GET();

              expect(statsResponse.status).toBe(200);
              await expect(statsResponse.json()).resolves.toEqual(
                expect.objectContaining({
                  uploadsBytes: Buffer.byteLength("upload-data"),
                  imagesBytes:
                    Buffer.byteLength("image-cache") +
                    Buffer.byteLength("keep-image") +
                    Buffer.byteLength("asset-image"),
                  videosBytes: Buffer.byteLength("video-cache") + Buffer.byteLength("asset-video"),
                  exportsBytes: Buffer.byteLength("export-data"),
                  totalBytes: expect.any(Number),
                  freeBytes: expect.any(Number),
                }),
              );

              const { POST } = await loadRouteModule<{
                POST: (request: Request) => Promise<Response>;
              }>("src/app/api/admin/storage/cleanup/route.ts", {
                sessionToken: adminSession.token,
              });
              const cleanupResponse = await POST(
                jsonRequest("http://localhost/api/admin/storage/cleanup", undefined, { method: "POST" }),
              );

              expect(cleanupResponse.status).toBe(200);
              await expect(cleanupResponse.json()).resolves.toEqual({
                deletedFiles: 2,
                freedBytes: Buffer.byteLength("image-cache") + Buffer.byteLength("video-cache"),
              });

              await expect(stat(imagesPath)).rejects.toMatchObject({ code: "ENOENT" });
              await expect(stat(videosPath)).rejects.toMatchObject({ code: "ENOENT" });
              await expect(stat(referencedOldImagePath)).resolves.toEqual(
                expect.objectContaining({
                  size: Buffer.byteLength("keep-image"),
                }),
              );
              await expect(stat(uploadsPath)).resolves.toEqual(
                expect.objectContaining({
                  size: Buffer.byteLength("upload-data"),
                }),
              );
              await expect(stat(exportsPath)).resolves.toEqual(
                expect.objectContaining({
                  size: Buffer.byteLength("export-data"),
                }),
              );
            },
            {
              STORAGE_ROOT: storageRoot,
            },
          );
        } finally {
          await rm(storageRoot, { recursive: true, force: true });
        }
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
