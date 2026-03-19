import { TaskStatus, TaskType, UserRole, UserStatus, type PrismaClient } from "@prisma/client";
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

async function createActiveUser(prisma: PrismaClient, username: string) {
  const passwordHash = await hashPasswordForTest("ProjectsAndTasks123!");

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

describe("projects and tasks api", () => {
  it("creates a project for the authenticated user", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "project-owner-create");
        const session = await insertSessionForUser(prisma, user.id);
        const { POST } = await loadRouteModule<{
          POST: (request: Request) => Promise<Response>;
        }>("src/app/api/projects/route.ts", {
          sessionToken: session.token,
        });

        const response = await POST(
          jsonRequest(
            "http://localhost/api/projects",
            {
              title: "Launch Trailer",
              idea: "A thriller teaser for launch day",
            },
            { method: "POST" },
          ),
        );

        expect(response.status).toBe(201);
        await expect(response.json()).resolves.toEqual(
          expect.objectContaining({
            id: expect.any(String),
            ownerId: user.id,
            title: "Launch Trailer",
            idea: "A thriller teaser for launch day",
            status: "active",
          }),
        );
        await expect(
          prisma.project.findFirstOrThrow({
            where: {
              ownerId: user.id,
              title: "Launch Trailer",
            },
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            ownerId: user.id,
            title: "Launch Trailer",
            idea: "A thriller teaser for launch day",
            status: "active",
          }),
        );
      });
    });
  });

  it("lists only the authenticated user's projects", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const owner = await createActiveUser(prisma, "project-owner-list");
        const otherUser = await createActiveUser(prisma, "project-owner-list-other");
        const session = await insertSessionForUser(prisma, owner.id);
        await prisma.project.createMany({
          data: [
            {
              ownerId: owner.id,
              title: "Owner Project",
              idea: "Owner idea",
            },
            {
              ownerId: otherUser.id,
              title: "Other Project",
              idea: "Other idea",
            },
          ],
        });
        const { GET } = await loadRouteModule<{
          GET: () => Promise<Response>;
        }>("src/app/api/projects/route.ts", {
          sessionToken: session.token,
        });

        const response = await GET();

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          projects: [
            expect.objectContaining({
              ownerId: owner.id,
              title: "Owner Project",
            }),
          ],
        });
      });
    });
  });

  it("gets and updates an owned project", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "project-owner-detail");
        const session = await insertSessionForUser(prisma, user.id);
        const project = await prisma.project.create({
          data: {
            ownerId: user.id,
            title: "Initial Project",
            idea: "Initial idea",
          },
        });
        const routeModule = await loadRouteModule<{
          GET: (
            request: Request,
            context: { params: Promise<{ projectId: string }> | { projectId: string } },
          ) => Promise<Response>;
          PATCH: (
            request: Request,
            context: { params: Promise<{ projectId: string }> | { projectId: string } },
          ) => Promise<Response>;
        }>("src/app/api/projects/[projectId]/route.ts", {
          sessionToken: session.token,
        });

        const getResponse = await routeModule.GET(
          new Request(`http://localhost/api/projects/${project.id}`),
          { params: { projectId: project.id } },
        );

        expect(getResponse.status).toBe(200);
        await expect(getResponse.json()).resolves.toEqual(
          expect.objectContaining({
            id: project.id,
            ownerId: user.id,
            title: "Initial Project",
            idea: "Initial idea",
          }),
        );

        const patchResponse = await routeModule.PATCH(
          jsonRequest(
            `http://localhost/api/projects/${project.id}`,
            {
              title: "Updated Project",
              idea: "Updated idea",
              status: "archived",
            },
            { method: "PATCH" },
          ),
          { params: { projectId: project.id } },
        );

        expect(patchResponse.status).toBe(200);
        await expect(patchResponse.json()).resolves.toEqual(
          expect.objectContaining({
            id: project.id,
            title: "Updated Project",
            idea: "Updated idea",
            status: "archived",
          }),
        );
        await expect(
          prisma.project.findUniqueOrThrow({
            where: { id: project.id },
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            id: project.id,
            ownerId: user.id,
            title: "Updated Project",
            idea: "Updated idea",
            status: "archived",
          }),
        );
      });
    });
  });

  it("creates a task record for an owned project and returns it", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "task-owner-create");
        const session = await insertSessionForUser(prisma, user.id);
        const project = await prisma.project.create({
          data: {
            ownerId: user.id,
            title: "Task Project",
          },
        });
        const tasksRoute = await loadRouteModule<{
          POST: (request: Request) => Promise<Response>;
        }>("src/app/api/tasks/route.ts", {
          sessionToken: session.token,
        });
        const taskDetailRoute = await loadRouteModule<{
          GET: (
            request: Request,
            context: { params: Promise<{ taskId: string }> | { taskId: string } },
          ) => Promise<Response>;
        }>("src/app/api/tasks/[taskId]/route.ts", {
          sessionToken: session.token,
        });

        const createResponse = await tasksRoute.POST(
          jsonRequest(
            "http://localhost/api/tasks",
            {
              projectId: project.id,
              type: TaskType.IMAGE,
              inputJson: {
                prompt: "Generate key visual",
              },
            },
            { method: "POST" },
          ),
        );

        expect(createResponse.status).toBe(201);
        const createdTask = await createResponse.json();
        expect(createdTask).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            projectId: project.id,
            createdById: user.id,
            type: TaskType.IMAGE,
            status: TaskStatus.QUEUED,
            inputJson: {
              prompt: "Generate key visual",
            },
          }),
        );
        await expect(
          prisma.task.findUniqueOrThrow({
            where: { id: createdTask.id },
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            id: createdTask.id,
            projectId: project.id,
            createdById: user.id,
            type: TaskType.IMAGE,
            status: TaskStatus.QUEUED,
          }),
        );

        const getResponse = await taskDetailRoute.GET(
          new Request(`http://localhost/api/tasks/${createdTask.id}`),
          { params: { taskId: createdTask.id } },
        );

        expect(getResponse.status).toBe(200);
        await expect(getResponse.json()).resolves.toEqual(
          expect.objectContaining({
            id: createdTask.id,
            projectId: project.id,
            createdById: user.id,
            type: TaskType.IMAGE,
            status: TaskStatus.QUEUED,
          }),
        );
      });
    });
  });

  it("updates task status for an owned task", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "task-owner-update");
        const session = await insertSessionForUser(prisma, user.id);
        const project = await prisma.project.create({
          data: {
            ownerId: user.id,
            title: "Task Status Project",
          },
        });
        const task = await prisma.task.create({
          data: {
            projectId: project.id,
            createdById: user.id,
            type: TaskType.VIDEO,
            status: TaskStatus.QUEUED,
            inputJson: {
              prompt: "Animate final clip",
            },
          },
        });
        const { PATCH } = await loadRouteModule<{
          PATCH: (
            request: Request,
            context: { params: Promise<{ taskId: string }> | { taskId: string } },
          ) => Promise<Response>;
        }>("src/app/api/tasks/[taskId]/route.ts", {
          sessionToken: session.token,
        });

        const response = await PATCH(
          jsonRequest(
            `http://localhost/api/tasks/${task.id}`,
            {
              status: TaskStatus.RUNNING,
              outputJson: {
                progress: 0.5,
              },
            },
            { method: "PATCH" },
          ),
          { params: { taskId: task.id } },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual(
          expect.objectContaining({
            id: task.id,
            status: TaskStatus.RUNNING,
            outputJson: {
              progress: 0.5,
            },
          }),
        );
        await expect(
          prisma.task.findUniqueOrThrow({
            where: { id: task.id },
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            id: task.id,
            status: TaskStatus.RUNNING,
            outputJson: {
              progress: 0.5,
            },
          }),
        );
      });
    });
  });

  it("does not allow accessing another user's project", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const owner = await createActiveUser(prisma, "project-owner-private");
        const otherUser = await createActiveUser(prisma, "project-owner-private-other");
        const otherSession = await insertSessionForUser(prisma, otherUser.id);
        const project = await prisma.project.create({
          data: {
            ownerId: owner.id,
            title: "Private Project",
          },
        });
        const { GET } = await loadRouteModule<{
          GET: (
            request: Request,
            context: { params: Promise<{ projectId: string }> | { projectId: string } },
          ) => Promise<Response>;
        }>("src/app/api/projects/[projectId]/route.ts", {
          sessionToken: otherSession.token,
        });

        const response = await GET(
          new Request(`http://localhost/api/projects/${project.id}`),
          { params: { projectId: project.id } },
        );

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({
          error: "Project not found",
        });
      });
    });
  });
});
