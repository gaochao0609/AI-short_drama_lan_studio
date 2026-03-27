import { ScriptSessionStatus, TaskStatus, TaskType, UserRole, UserStatus, type PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTestDatabase } from "../db/test-database";
import {
  hashPasswordForTest,
  insertSessionForUser,
  jsonRequest,
  loadRouteModule,
  withApiTestEnv,
} from "./test-api";

const { enqueueTaskMock, streamProxyModelMock } = vi.hoisted(() => ({
  enqueueTaskMock: vi.fn(),
  streamProxyModelMock: vi.fn(),
}));

vi.mock("@/lib/models/proxy-client", () => ({
  callProxyModel: vi.fn(),
  streamProxyModel: streamProxyModelMock,
}));

vi.mock("@/lib/queues/enqueue", () => ({
  enqueueTask: enqueueTaskMock,
}));

afterEach(() => {
  enqueueTaskMock.mockReset();
  streamProxyModelMock.mockReset();
  vi.doUnmock("next/headers");
  vi.resetModules();
});

async function createActiveUser(prisma: PrismaClient, username: string) {
  const passwordHash = await hashPasswordForTest("ScriptSession123!");

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

async function createProjectWithProvider(prisma: PrismaClient, ownerId: string, suffix: string) {
  const project = await prisma.project.create({
    data: {
      ownerId,
      title: `Project ${suffix}`,
      idea: `Idea ${suffix}`,
    },
  });

  await prisma.modelProvider.create({
    data: {
      key: "script",
      label: "Script Provider",
      providerName: "openai",
      modelName: "gpt-4.1-mini",
      baseUrl: "https://proxy.example.com/script",
      enabled: true,
    },
  });

  return project;
}

function createTextStream(...chunks: string[]) {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }

      controller.close();
    },
  });
}

describe("script session api", () => {
  it("creates a session, returns SSE, and persists the first streamed question", async () => {
    streamProxyModelMock.mockResolvedValueOnce(
      createTextStream("Who is your main character", " and what do they want?"),
    );

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "script-session-create");
        const session = await insertSessionForUser(prisma, user.id);
        const project = await createProjectWithProvider(prisma, user.id, "create");
        const { POST } = await loadRouteModule<{
          POST: (request: Request) => Promise<Response>;
        }>("src/app/api/script/sessions/route.ts", {
          sessionToken: session.token,
        });

        const response = await POST(
          jsonRequest(
            "http://localhost/api/script/sessions",
            {
              projectId: project.id,
              idea: "A courier discovers a citywide memory blackout.",
            },
            { method: "POST" },
          ),
        );

        expect(response.status).toBe(201);
        expect(response.headers.get("content-type")).toContain("text/event-stream");
        await expect(response.text()).resolves.toContain("Who is your main character and what do they want?");
        expect(enqueueTaskMock).not.toHaveBeenCalled();
        expect(streamProxyModelMock).toHaveBeenCalledWith(
          expect.objectContaining({
            taskType: "script_question_generate",
            providerKey: "script",
            model: "gpt-4.1-mini",
            traceId: expect.any(String),
          }),
        );

        await expect(
          prisma.scriptSession.findFirstOrThrow({
            where: {
              projectId: project.id,
              creatorId: user.id,
            },
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            projectId: project.id,
            creatorId: user.id,
            idea: "A courier discovers a citywide memory blackout.",
            status: ScriptSessionStatus.ACTIVE,
            completedRounds: 0,
            currentQuestion: "Who is your main character and what do they want?",
            qaRecordsJson: [],
          }),
        );
      });
    });
  });

  it("streams the next question and records the previous round answer", async () => {
    streamProxyModelMock.mockResolvedValueOnce(
      createTextStream("What is the hero", "'s deepest fear?"),
    );

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "script-session-message");
        const session = await insertSessionForUser(prisma, user.id);
        const project = await createProjectWithProvider(prisma, user.id, "message");
        const scriptSession = await prisma.scriptSession.create({
          data: {
            projectId: project.id,
            creatorId: user.id,
            idea: "Initial idea",
            currentQuestion: "What kind of world is this story set in?",
            qaRecordsJson: [],
          },
        });
        const { POST } = await loadRouteModule<{
          POST: (
            request: Request,
            context: { params: Promise<{ sessionId: string }> | { sessionId: string } },
          ) => Promise<Response>;
        }>("src/app/api/script/sessions/[sessionId]/message/route.ts", {
          sessionToken: session.token,
        });

        const response = await POST(
          jsonRequest(
            `http://localhost/api/script/sessions/${scriptSession.id}/message`,
            {
              answer: "A near-future river city built on stacked flood barriers.",
            },
            { method: "POST" },
          ),
          { params: { sessionId: scriptSession.id } },
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/event-stream");
        await expect(response.text()).resolves.toContain("What is the hero's deepest fear?");
        expect(enqueueTaskMock).not.toHaveBeenCalled();
        expect(streamProxyModelMock).toHaveBeenCalledWith(
          expect.objectContaining({
            taskType: "script_question_generate",
            traceId: expect.any(String),
          }),
        );

        await expect(
          prisma.scriptSession.findUniqueOrThrow({
            where: { id: scriptSession.id },
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            id: scriptSession.id,
            completedRounds: 1,
            currentQuestion: "What is the hero's deepest fear?",
            qaRecordsJson: [
              {
                round: 1,
                question: "What kind of world is this story set in?",
                answer: "A near-future river city built on stacked flood barriers.",
              },
            ],
          }),
        );
      });
    });
  });

  it("regenerates the current question without advancing the session round", async () => {
    streamProxyModelMock.mockResolvedValueOnce(
      createTextStream("What does the antagonist hide", " from everyone else?"),
    );

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "script-session-regenerate");
        const session = await insertSessionForUser(prisma, user.id);
        const project = await createProjectWithProvider(prisma, user.id, "regenerate");
        const scriptSession = await prisma.scriptSession.create({
          data: {
            projectId: project.id,
            creatorId: user.id,
            idea: "Initial idea",
            completedRounds: 1,
            currentQuestion: "What secret has the antagonist buried?",
            qaRecordsJson: [
              {
                round: 1,
                question: "What kind of world is this story set in?",
                answer: "A flooded megacity.",
              },
            ],
          },
        });
        const { POST } = await loadRouteModule<{
          POST: (
            request: Request,
            context: { params: Promise<{ sessionId: string }> | { sessionId: string } },
          ) => Promise<Response>;
        }>("src/app/api/script/sessions/[sessionId]/regenerate/route.ts", {
          sessionToken: session.token,
        });

        const response = await POST(
          jsonRequest(
            `http://localhost/api/script/sessions/${scriptSession.id}/regenerate`,
            undefined,
            { method: "POST" },
          ),
          { params: { sessionId: scriptSession.id } },
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/event-stream");
        await expect(response.text()).resolves.toContain("What does the antagonist hide from everyone else?");
        expect(enqueueTaskMock).not.toHaveBeenCalled();
        expect(streamProxyModelMock).toHaveBeenCalledWith(
          expect.objectContaining({
            taskType: "script_question_generate",
            traceId: expect.any(String),
          }),
        );

        await expect(
          prisma.scriptSession.findUniqueOrThrow({
            where: { id: scriptSession.id },
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            id: scriptSession.id,
            completedRounds: 1,
            currentQuestion: "What does the antagonist hide from everyone else?",
            qaRecordsJson: [
              {
                round: 1,
                question: "What kind of world is this story set in?",
                answer: "A flooded megacity.",
              },
            ],
          }),
        );
      });
    });
  });

  it("creates a finalize task for the session and enqueues SCRIPT_FINALIZE", async () => {
    enqueueTaskMock.mockResolvedValueOnce({
      jobId: "job-script-finalize",
      queueName: "script-queue",
    });

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "script-session-finalize");
        const session = await insertSessionForUser(prisma, user.id);
        const project = await createProjectWithProvider(prisma, user.id, "finalize");
        const scriptSession = await prisma.scriptSession.create({
          data: {
            projectId: project.id,
            creatorId: user.id,
            idea: "Initial idea",
            completedRounds: 2,
            currentQuestion: "What does the ending cost the hero?",
            qaRecordsJson: [
              {
                round: 1,
                question: "Who is the hero?",
                answer: "A courier.",
              },
              {
                round: 2,
                question: "What does she fear?",
                answer: "Forgetting her brother.",
              },
            ],
          },
        });
        const { POST } = await loadRouteModule<{
          POST: (
            request: Request,
            context: { params: Promise<{ sessionId: string }> | { sessionId: string } },
          ) => Promise<Response>;
        }>("src/app/api/script/sessions/[sessionId]/finalize/route.ts", {
          sessionToken: session.token,
        });

        const response = await POST(
          jsonRequest(
            `http://localhost/api/script/sessions/${scriptSession.id}/finalize`,
            undefined,
            { method: "POST" },
          ),
          { params: { sessionId: scriptSession.id } },
        );

        expect(response.status).toBe(202);
        await expect(response.json()).resolves.toEqual({
          taskId: expect.any(String),
        });
        expect(streamProxyModelMock).not.toHaveBeenCalled();
        expect(enqueueTaskMock).toHaveBeenCalledWith(
          expect.any(String),
          TaskType.SCRIPT_FINALIZE,
          expect.objectContaining({
            sessionId: scriptSession.id,
            traceId: expect.any(String),
          }),
        );

        const task = await prisma.task.findFirstOrThrow({
          where: {
            projectId: project.id,
            createdById: user.id,
            type: TaskType.SCRIPT_FINALIZE,
          },
          orderBy: {
            createdAt: "desc",
          },
        });

        expect(task).toEqual(
          expect.objectContaining({
            projectId: project.id,
            createdById: user.id,
            type: TaskType.SCRIPT_FINALIZE,
            status: TaskStatus.QUEUED,
            inputJson: {
              sessionId: scriptSession.id,
            },
          }),
        );
      });
    });
  });

  it("does not accept new answers after the session has completed", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "script-session-completed");
        const session = await insertSessionForUser(prisma, user.id);
        const project = await createProjectWithProvider(prisma, user.id, "completed");
        const scriptSession = await prisma.scriptSession.create({
          data: {
            projectId: project.id,
            creatorId: user.id,
            idea: "Initial idea",
            status: ScriptSessionStatus.COMPLETED,
            completedRounds: 2,
            currentQuestion: null,
            completedAt: new Date(),
            qaRecordsJson: [
              {
                round: 1,
                question: "Who is the hero?",
                answer: "A courier.",
              },
            ],
          },
        });
        const { POST } = await loadRouteModule<{
          POST: (
            request: Request,
            context: { params: Promise<{ sessionId: string }> | { sessionId: string } },
          ) => Promise<Response>;
        }>("src/app/api/script/sessions/[sessionId]/message/route.ts", {
          sessionToken: session.token,
        });

        const response = await POST(
          jsonRequest(
            `http://localhost/api/script/sessions/${scriptSession.id}/message`,
            {
              answer: "One more answer.",
            },
            { method: "POST" },
          ),
          { params: { sessionId: scriptSession.id } },
        );

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
          error: "Script session is already completed",
        });
        expect(streamProxyModelMock).not.toHaveBeenCalled();
        expect(enqueueTaskMock).not.toHaveBeenCalled();
      });
    });
  });
});
