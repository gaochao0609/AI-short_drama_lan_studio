import { TaskType, UserRole, UserStatus, type PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTestDatabase } from "../db/test-database";
import {
  hashPasswordForTest,
  insertSessionForUser,
  jsonRequest,
  loadRouteModule,
  withApiTestEnv,
} from "./test-api";

const { enqueueTaskMock } = vi.hoisted(() => ({
  enqueueTaskMock: vi.fn(),
}));

vi.mock("@/lib/queues/enqueue", () => ({
  enqueueTask: enqueueTaskMock,
}));

afterEach(() => {
  enqueueTaskMock.mockReset();
  vi.doUnmock("next/headers");
  vi.resetModules();
});

async function createActiveUser(prisma: PrismaClient, username: string) {
  const passwordHash = await hashPasswordForTest("Storyboard123!");

  return prisma.user.create({
    data: {
      username,
      passwordHash,
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      forcePasswordChange: false,
    },
  });
}

describe("storyboards api", () => {
  it("returns storyboard page data from a storyboard-specific read path", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "storyboard-reader");
        const session = await insertSessionForUser(prisma, user.id);
        const project = await prisma.project.create({
          data: {
            ownerId: user.id,
            title: "Storyboard Project",
            idea: "A courier races the sunrise.",
          },
        });
        await prisma.scriptVersion.createMany({
          data: [
            {
              projectId: project.id,
              creatorId: user.id,
              versionNumber: 1,
              body: "First script body",
              scriptJson: {
                body: "First script body",
              },
            },
            {
              projectId: project.id,
              creatorId: user.id,
              versionNumber: 2,
              body: "Second script body",
              scriptJson: {
                body: "Second script body",
              },
            },
          ],
        });

        const storyboardRoute = await loadRouteModule<{
          GET: (
            request: Request,
            context?: { params?: never },
          ) => Promise<Response>;
        }>("src/app/api/storyboards/route.ts", {
          sessionToken: session.token,
        });
        const projectRoute = await loadRouteModule<{
          GET: (
            request: Request,
            context: { params: Promise<{ projectId: string }> | { projectId: string } },
          ) => Promise<Response>;
        }>("src/app/api/projects/[projectId]/route.ts", {
          sessionToken: session.token,
        });

        const storyboardResponse = await storyboardRoute.GET(
          new Request(`http://localhost/api/storyboards?projectId=${project.id}`),
        );

        expect(storyboardResponse.status).toBe(200);
        await expect(storyboardResponse.json()).resolves.toEqual(
          expect.objectContaining({
            project: expect.objectContaining({
              id: project.id,
              title: "Storyboard Project",
              idea: "A courier races the sunrise.",
            }),
            scriptVersions: [
              expect.objectContaining({
                versionNumber: 2,
                body: "Second script body",
              }),
              expect.objectContaining({
                versionNumber: 1,
                body: "First script body",
              }),
            ],
          }),
        );

        const projectResponse = await projectRoute.GET(
          new Request(`http://localhost/api/projects/${project.id}`),
          { params: { projectId: project.id } },
        );

        expect(projectResponse.status).toBe(200);
        await expect(projectResponse.json()).resolves.not.toHaveProperty(
          "scriptVersions",
        );
      });
    });
  });

  it("reuses the same storyboard task for duplicate POST requests", async () => {
    enqueueTaskMock.mockResolvedValue({
      jobId: "job-storyboard-1",
      queueName: "storyboard-queue",
    });

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "storyboard-request-owner");
        const session = await insertSessionForUser(prisma, user.id);
        const project = await prisma.project.create({
          data: {
            ownerId: user.id,
            title: "Storyboard Request Project",
          },
        });
        const scriptVersion = await prisma.scriptVersion.create({
          data: {
            projectId: project.id,
            creatorId: user.id,
            versionNumber: 1,
            body: "INT. ROOFTOP - DAWN",
            scriptJson: {
              body: "INT. ROOFTOP - DAWN",
            },
          },
        });
        const { POST } = await loadRouteModule<{
          POST: (request: Request) => Promise<Response>;
        }>("src/app/api/storyboards/route.ts", {
          sessionToken: session.token,
        });

        const firstResponse = await POST(
          jsonRequest(
            "http://localhost/api/storyboards",
            {
              projectId: project.id,
              scriptVersionId: scriptVersion.id,
            },
            { method: "POST" },
          ),
        );
        const firstPayload = (await firstResponse.json()) as { taskId: string };
        const secondResponse = await POST(
          jsonRequest(
            "http://localhost/api/storyboards",
            {
              projectId: project.id,
              scriptVersionId: scriptVersion.id,
            },
            { method: "POST" },
          ),
        );
        const secondPayload = (await secondResponse.json()) as { taskId: string };

        expect(firstResponse.status).toBe(202);
        expect(secondResponse.status).toBe(202);
        expect(firstPayload.taskId).toBe(secondPayload.taskId);
        expect(enqueueTaskMock).toHaveBeenCalledTimes(1);
        await expect(
          prisma.task.findMany({
            where: {
              projectId: project.id,
              createdById: user.id,
              type: TaskType.STORYBOARD,
            },
          }),
        ).resolves.toHaveLength(1);
      });
    });
  });

  it("keeps a failed storyboard task durable when enqueueing fails", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        enqueueTaskMock.mockImplementationOnce(async (taskId: string) => {
          await prisma.task.update({
            where: {
              id: taskId,
            },
            data: {
              status: "FAILED",
              finishedAt: new Date(),
              errorText: "queue unavailable",
            },
          });

          throw new Error("queue unavailable");
        });

        const user = await createActiveUser(prisma, "storyboard-request-failure");
        const session = await insertSessionForUser(prisma, user.id);
        const project = await prisma.project.create({
          data: {
            ownerId: user.id,
            title: "Storyboard Failure Project",
          },
        });
        const scriptVersion = await prisma.scriptVersion.create({
          data: {
            projectId: project.id,
            creatorId: user.id,
            versionNumber: 1,
            body: "INT. TRAIN PLATFORM - NIGHT",
            scriptJson: {
              body: "INT. TRAIN PLATFORM - NIGHT",
            },
          },
        });
        const storyboardRoute = await loadRouteModule<{
          POST: (request: Request) => Promise<Response>;
        }>("src/app/api/storyboards/route.ts", {
          sessionToken: session.token,
        });
        const taskRoute = await loadRouteModule<{
          GET: (
            request: Request,
            context: { params: Promise<{ taskId: string }> | { taskId: string } },
          ) => Promise<Response>;
        }>("src/app/api/tasks/[taskId]/route.ts", {
          sessionToken: session.token,
        });

        const response = await storyboardRoute.POST(
          jsonRequest(
            "http://localhost/api/storyboards",
            {
              projectId: project.id,
              scriptVersionId: scriptVersion.id,
            },
            { method: "POST" },
          ),
        );

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({
          error: "Internal server error",
        });

        const task = await prisma.task.findFirstOrThrow({
          where: {
            projectId: project.id,
            createdById: user.id,
            type: TaskType.STORYBOARD,
          },
        });

        await expect(
          prisma.task.findUniqueOrThrow({
            where: {
              id: task.id,
            },
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            id: task.id,
            status: "FAILED",
            errorText: "queue unavailable",
          }),
        );

        const taskResponse = await taskRoute.GET(
          new Request(`http://localhost/api/tasks/${task.id}`),
          { params: { taskId: task.id } },
        );

        expect(taskResponse.status).toBe(200);
        await expect(taskResponse.json()).resolves.toEqual(
          expect.objectContaining({
            id: task.id,
            status: "FAILED",
            errorText: "queue unavailable",
          }),
        );
      });
    });
  });
});
