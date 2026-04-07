import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AssetCategory,
  AssetOrigin,
  ScriptSessionStatus,
  TaskStatus,
  TaskType,
  UserRole,
  UserStatus,
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

const { callProxyModelMock, enqueueTaskMock, streamProxyModelMock } = vi.hoisted(() => ({
  callProxyModelMock: vi.fn(),
  enqueueTaskMock: vi.fn(),
  streamProxyModelMock: vi.fn(),
}));

vi.mock("@/lib/models/proxy-client", () => ({
  callProxyModel: callProxyModelMock,
  streamProxyModel: streamProxyModelMock,
}));

vi.mock("@/lib/queues/enqueue", () => ({
  enqueueTask: enqueueTaskMock,
}));

afterEach(() => {
  callProxyModelMock.mockReset();
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

function createErroringTextStream(...chunks: string[]) {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }

      controller.error(new Error("stream interrupted"));
    },
  });
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

describe("script session api", () => {
  it("does not persist a new session when the first question generation fails", async () => {
    streamProxyModelMock.mockRejectedValueOnce(new Error("proxy unavailable"));

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "script-session-start-fail");
        const session = await insertSessionForUser(prisma, user.id);
        const project = await createProjectWithProvider(prisma, user.id, "start-fail");
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
              idea: "A city forgets the same hour every night.",
            },
            { method: "POST" },
          ),
        );

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({
          error: "Internal server error",
        });
        await expect(
          prisma.scriptSession.findMany({
            where: {
              projectId: project.id,
              creatorId: user.id,
            },
          }),
        ).resolves.toHaveLength(0);
      });
    });
  });

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
        const startedSessionId = streamProxyModelMock.mock.calls[0]?.[0]?.options?.sessionId;
        expect(typeof startedSessionId).toBe("string");
        await expect(
          prisma.scriptSession.findUnique({
            where: {
              id: startedSessionId,
            },
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            id: startedSessionId,
            projectId: project.id,
            creatorId: user.id,
            idea: "A courier discovers a citywide memory blackout.",
            status: ScriptSessionStatus.ACTIVE,
            completedRounds: 0,
            currentQuestion: null,
            qaRecordsJson: [],
          }),
        );
        await expect(response.text()).resolves.toContain("Who is your main character and what do they want?");
        expect(enqueueTaskMock).not.toHaveBeenCalled();
        expect(streamProxyModelMock).toHaveBeenCalledWith(
          expect.objectContaining({
            taskType: "script_question_generate",
            providerKey: "script",
            model: "gpt-4.1-mini",
            traceId: expect.any(String),
            inputText: expect.stringContaining(
              "Use Socratic questioning to clarify the concept step by step.",
            ),
          }),
        );
        expect(streamProxyModelMock.mock.calls[0]?.[0]?.inputText).toContain(
          "Prioritize whichever story element is still vague: characters, core conflict, structure, emotional arc, then ending.",
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

  it("deletes a newly created session if the first-question stream fails before completion", async () => {
    streamProxyModelMock.mockResolvedValueOnce(
      createErroringTextStream("Who is your main character"),
    );

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "script-session-stream-fail");
        const session = await insertSessionForUser(prisma, user.id);
        const project = await createProjectWithProvider(prisma, user.id, "stream-fail");
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
        const startedSessionId = streamProxyModelMock.mock.calls[0]?.[0]?.options?.sessionId;
        expect(typeof startedSessionId).toBe("string");
        await expect(response.text()).resolves.toContain("event: error");
        await expect(
          prisma.scriptSession.findUnique({
            where: {
              id: startedSessionId,
            },
          }),
        ).resolves.toBeNull();
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
        await expect(
          prisma.scriptSession.findUniqueOrThrow({
            where: { id: scriptSession.id },
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            id: scriptSession.id,
            completedRounds: 1,
            currentQuestion: null,
            qaRecordsJson: [
              {
                round: 1,
                question: "What kind of world is this story set in?",
                answer: "A near-future river city built on stacked flood barriers.",
              },
            ],
          }),
        );
        await expect(response.text()).resolves.toContain("What is the hero's deepest fear?");
        expect(enqueueTaskMock).not.toHaveBeenCalled();
        expect(streamProxyModelMock).toHaveBeenCalledWith(
          expect.objectContaining({
            taskType: "script_question_generate",
            traceId: expect.any(String),
            inputText: expect.stringContaining(
              "Use Socratic questioning to clarify the concept step by step.",
            ),
          }),
        );
        expect(streamProxyModelMock.mock.calls[0]?.[0]?.inputText).toContain(
          "Ask about only one missing element at a time and avoid repeating details the user already clarified.",
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

  it("stages the answer before the next-question stream completes and blocks stale writes", async () => {
    const nextQuestionRelease = createDeferred<void>();
    const encoder = new TextEncoder();
    streamProxyModelMock.mockResolvedValueOnce(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          await nextQuestionRelease.promise;
          controller.enqueue(encoder.encode("What is the hero's deepest fear?"));
          controller.close();
        },
      }),
    );

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "script-session-message-staged");
        const session = await insertSessionForUser(prisma, user.id);
        const project = await createProjectWithProvider(prisma, user.id, "message-staged");
        const scriptSession = await prisma.scriptSession.create({
          data: {
            projectId: project.id,
            creatorId: user.id,
            idea: "Initial idea",
            currentQuestion: "What kind of world is this story set in?",
            qaRecordsJson: [],
          },
        });
        const { POST: answerPost } = await loadRouteModule<{
          POST: (
            request: Request,
            context: { params: Promise<{ sessionId: string }> | { sessionId: string } },
          ) => Promise<Response>;
        }>("src/app/api/script/sessions/[sessionId]/message/route.ts", {
          sessionToken: session.token,
        });
        const { POST: regeneratePost } = await loadRouteModule<{
          POST: (
            request: Request,
            context: { params: Promise<{ sessionId: string }> | { sessionId: string } },
          ) => Promise<Response>;
        }>("src/app/api/script/sessions/[sessionId]/regenerate/route.ts", {
          sessionToken: session.token,
        });

        const response = await answerPost(
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
        await expect(
          prisma.scriptSession.findUniqueOrThrow({
            where: { id: scriptSession.id },
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            id: scriptSession.id,
            completedRounds: 1,
            currentQuestion: null,
            qaRecordsJson: [
              {
                round: 1,
                question: "What kind of world is this story set in?",
                answer: "A near-future river city built on stacked flood barriers.",
              },
            ],
          }),
        );

        const retryAnswerResponse = await answerPost(
          jsonRequest(
            `http://localhost/api/script/sessions/${scriptSession.id}/message`,
            {
              answer: "A vertical port city where the levees are homes.",
            },
            { method: "POST" },
          ),
          { params: { sessionId: scriptSession.id } },
        );
        const regenerateResponse = await regeneratePost(
          jsonRequest(
            `http://localhost/api/script/sessions/${scriptSession.id}/regenerate`,
            undefined,
            { method: "POST" },
          ),
          { params: { sessionId: scriptSession.id } },
        );

        expect(retryAnswerResponse.status).toBe(409);
        await expect(retryAnswerResponse.json()).resolves.toEqual({
          error: "Script session does not have a pending question",
        });
        expect(regenerateResponse.status).toBe(409);
        await expect(regenerateResponse.json()).resolves.toEqual({
          error: "Script session does not have a current question",
        });
        expect(streamProxyModelMock).toHaveBeenCalledTimes(1);

        nextQuestionRelease.resolve();
        await expect(response.text()).resolves.toContain("What is the hero's deepest fear?");
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

  it("restores the previous question when next-question generation fails", async () => {
    streamProxyModelMock.mockRejectedValueOnce(new Error("proxy unavailable"));

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "script-session-message-fail");
        const session = await insertSessionForUser(prisma, user.id);
        const project = await createProjectWithProvider(prisma, user.id, "message-fail");
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

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({
          error: "Internal server error",
        });
        await expect(
          prisma.scriptSession.findUniqueOrThrow({
            where: { id: scriptSession.id },
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            id: scriptSession.id,
            completedRounds: 0,
            currentQuestion: "What kind of world is this story set in?",
            qaRecordsJson: [],
          }),
        );
      });
    });
  });

  it("restores the previous question when next-question SSE fails before completion", async () => {
    streamProxyModelMock.mockResolvedValueOnce(
      createErroringTextStream("What is the hero"),
    );

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "script-session-message-stream-fail");
        const session = await insertSessionForUser(prisma, user.id);
        const project = await createProjectWithProvider(prisma, user.id, "message-stream-fail");
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
        await expect(response.text()).resolves.toContain("event: error");
        await expect(
          prisma.scriptSession.findUniqueOrThrow({
            where: { id: scriptSession.id },
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            id: scriptSession.id,
            completedRounds: 0,
            currentQuestion: "What kind of world is this story set in?",
            qaRecordsJson: [],
          }),
        );
      });
    });
  });

  it("allows retrying the answer after next-question generation fails", async () => {
    streamProxyModelMock
      .mockRejectedValueOnce(new Error("proxy unavailable"))
      .mockResolvedValueOnce(
        createTextStream("What secret does the city", " hide underwater?"),
      );

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "script-session-message-retry");
        const session = await insertSessionForUser(prisma, user.id);
        const project = await createProjectWithProvider(prisma, user.id, "message-retry");
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

        const firstResponse = await POST(
          jsonRequest(
            `http://localhost/api/script/sessions/${scriptSession.id}/message`,
            {
              answer: "A near-future river city built on stacked flood barriers.",
            },
            { method: "POST" },
          ),
          { params: { sessionId: scriptSession.id } },
        );

        expect(firstResponse.status).toBe(500);
        await expect(firstResponse.json()).resolves.toEqual({
          error: "Internal server error",
        });

        const secondResponse = await POST(
          jsonRequest(
            `http://localhost/api/script/sessions/${scriptSession.id}/message`,
            {
              answer: "A vertical port city where the levees are homes.",
            },
            { method: "POST" },
          ),
          { params: { sessionId: scriptSession.id } },
        );

        expect(secondResponse.status).toBe(200);
        await expect(secondResponse.text()).resolves.toContain(
          "What secret does the city hide underwater?",
        );
        await expect(
          prisma.scriptSession.findUniqueOrThrow({
            where: { id: scriptSession.id },
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            id: scriptSession.id,
            completedRounds: 1,
            currentQuestion: "What secret does the city hide underwater?",
            qaRecordsJson: [
              {
                round: 1,
                question: "What kind of world is this story set in?",
                answer: "A vertical port city where the levees are homes.",
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

  it("regenerateCurrentQuestion returns the generation stream contract and updates the question on completion", async () => {
    streamProxyModelMock.mockResolvedValueOnce(
      createTextStream("What does the antagonist hide", " from everyone else?"),
    );

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "script-session-regenerate-service");
        const project = await createProjectWithProvider(prisma, user.id, "regenerate-service");
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
        const { regenerateCurrentQuestion } = await loadRouteModule<
          typeof import("../../../src/lib/services/script-sessions")
        >("src/lib/services/script-sessions.ts");

        const generation = await regenerateCurrentQuestion(
          scriptSession.id,
          user.id,
        ) as unknown as {
          sessionId: string;
          traceId: string;
          proxyStream: ReadableStream<Uint8Array>;
          persistGeneratedQuestion: (questionText: string) => Promise<void>;
        };

        expect(generation.sessionId).toBe(scriptSession.id);
        expect(generation.traceId).toEqual(expect.any(String));
        expect(generation.proxyStream).toBeInstanceOf(ReadableStream);
        expect(generation.persistGeneratedQuestion).toEqual(expect.any(Function));
        expect(streamProxyModelMock).toHaveBeenCalledWith(
          expect.objectContaining({
            taskType: "script_question_generate",
            traceId: generation.traceId,
            options: expect.objectContaining({
              sessionId: scriptSession.id,
              projectId: project.id,
              mode: "regenerate",
            }),
          }),
        );

        await generation.persistGeneratedQuestion(
          "What does the antagonist hide from everyone else?",
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

  it("does not overwrite a regenerated question if the session changes before completion", async () => {
    streamProxyModelMock.mockResolvedValueOnce(
      createTextStream("What does the antagonist hide", " from everyone else?"),
    );

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "script-session-regenerate-cas");
        const project = await createProjectWithProvider(prisma, user.id, "regenerate-cas");
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
        const { regenerateCurrentQuestion } = await loadRouteModule<
          typeof import("../../../src/lib/services/script-sessions")
        >("src/lib/services/script-sessions.ts");

        const generation = await regenerateCurrentQuestion(
          scriptSession.id,
          user.id,
        ) as unknown as {
          persistGeneratedQuestion: (questionText: string) => Promise<void>;
        };

        await prisma.scriptSession.update({
          where: {
            id: scriptSession.id,
          },
          data: {
            currentQuestion: "What truth is the hero refusing to face?",
          },
        });

        await expect(
          generation.persistGeneratedQuestion(
            "What does the antagonist hide from everyone else?",
          ),
        ).rejects.toMatchObject({
          status: 409,
          message: "Script session changed before the regenerated question could be saved",
        });

        await expect(
          prisma.scriptSession.findUniqueOrThrow({
            where: { id: scriptSession.id },
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            id: scriptSession.id,
            currentQuestion: "What truth is the hero refusing to face?",
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
        await expect(
          prisma.scriptSession.findUniqueOrThrow({
            where: { id: scriptSession.id },
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            id: scriptSession.id,
            status: "FINALIZING",
          }),
        );
      });
    });
  });

  it("mirrors finalized scripts into one generated asset and stays consistent with backfill", async () => {
    enqueueTaskMock.mockResolvedValueOnce({
      jobId: "job-script-finalize-asset",
      queueName: "script-queue",
    });
    callProxyModelMock.mockResolvedValueOnce({
      status: "ok",
      textOutput: "INT. ROOFTOP - NIGHT\nThe rain starts as the hero arrives.",
      rawResponse: {
        usage: {
          input: 128,
          output: 256,
        },
      },
    });

    const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-script-finalize-asset-"));

    try {
      await withTestDatabase(async ({ databaseUrl, prisma }) => {
        await withApiTestEnv(
          databaseUrl,
          async () => {
        const user = await createActiveUser(prisma, "script-session-finalize-asset");
        const session = await insertSessionForUser(prisma, user.id);
        const project = await createProjectWithProvider(prisma, user.id, "finalize-asset");
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
            ],
          },
        });
        const { POST: finalizePost } = await loadRouteModule<{
          POST: (
            request: Request,
            context: { params: Promise<{ sessionId: string }> | { sessionId: string } },
          ) => Promise<Response>;
        }>("src/app/api/script/sessions/[sessionId]/finalize/route.ts", {
          sessionToken: session.token,
        });
        const { GET: downloadGet } = await loadRouteModule<{
          GET: (
            request: Request,
            context: { params: Promise<{ assetId: string }> | { assetId: string } },
          ) => Promise<Response>;
        }>("src/app/api/assets/[assetId]/download/route.ts", {
          sessionToken: session.token,
        });
        const { processScriptFinalizeJob } = await import("@/worker/processors/script");
        const { backfillAssetCenter } = await import("@/lib/services/asset-backfill");

        const finalizeResponse = await finalizePost(
          jsonRequest(
            `http://localhost/api/script/sessions/${scriptSession.id}/finalize`,
            undefined,
            { method: "POST" },
          ),
          { params: { sessionId: scriptSession.id } },
        );

        expect(finalizeResponse.status).toBe(202);
        const finalizePayload = await finalizeResponse.json() as { taskId: string };
        expect(finalizePayload).toEqual({
          taskId: expect.any(String),
        });

        const task = await prisma.task.findUniqueOrThrow({
          where: {
            id: finalizePayload.taskId,
          },
          select: {
            id: true,
          },
        });
        const taskStep = await prisma.taskStep.create({
          data: {
            taskId: task.id,
            stepKey: TaskType.SCRIPT_FINALIZE,
            status: TaskStatus.QUEUED,
            inputJson: {
              sessionId: scriptSession.id,
            },
          },
          select: {
            id: true,
          },
        });

        const firstRun = await processScriptFinalizeJob({
          attemptsMade: 0,
          opts: {
            attempts: 3,
          },
          data: {
            taskId: task.id,
            taskStepId: taskStep.id,
            traceId: "trace-script-finalize-asset",
            payload: {
              sessionId: scriptSession.id,
              traceId: "trace-script-finalize-asset",
            },
          },
        } as Parameters<typeof processScriptFinalizeJob>[0]);

        const taskAfterFirstRun = await prisma.task.findUniqueOrThrow({
          where: {
            id: task.id,
          },
          select: {
            outputJson: true,
          },
        });
        expect(taskAfterFirstRun.outputJson).toEqual(
          expect.objectContaining({
            scriptVersionId: firstRun.scriptVersionId,
          }),
        );

        const generatedAssetsAfterFirstRun = await prisma.asset.findMany({
          where: {
            projectId: project.id,
            category: AssetCategory.SCRIPT_GENERATED,
            metadata: {
              path: ["scriptVersionId"],
              equals: firstRun.scriptVersionId,
            },
          },
          orderBy: {
            createdAt: "asc",
          },
        });
        expect(generatedAssetsAfterFirstRun).toHaveLength(1);
        expect(generatedAssetsAfterFirstRun[0]).toEqual(
          expect.objectContaining({
            category: AssetCategory.SCRIPT_GENERATED,
            origin: AssetOrigin.SYSTEM,
          }),
        );
        expect(generatedAssetsAfterFirstRun[0]?.metadata).toEqual(
          expect.objectContaining({
            parseStatus: "ready",
            scriptSessionId: scriptSession.id,
            scriptVersionId: firstRun.scriptVersionId,
            extractedText: "INT. ROOFTOP - NIGHT\nThe rain starts as the hero arrives.",
            sourceTask: {
              taskId: task.id,
              taskType: TaskType.SCRIPT_FINALIZE,
              traceId: "trace-script-finalize-asset",
            },
          }),
        );
        const generatedAssetId = generatedAssetsAfterFirstRun[0]?.id;
        expect(typeof generatedAssetId).toBe("string");
        const downloadResponse = await downloadGet(
          new Request(`http://localhost/api/assets/${generatedAssetId}/download`, {
            method: "GET",
          }),
          {
            params: { assetId: generatedAssetId as string },
          },
        );
        expect(downloadResponse.status).toBe(200);
        expect(downloadResponse.headers.get("content-type")).toBe("text/plain");
        await expect(downloadResponse.text()).resolves.toBe(
          "INT. ROOFTOP - NIGHT\nThe rain starts as the hero arrives.",
        );

        const secondRun = await processScriptFinalizeJob({
          attemptsMade: 1,
          opts: {
            attempts: 3,
          },
          data: {
            taskId: task.id,
            taskStepId: taskStep.id,
            traceId: "trace-script-finalize-asset",
            payload: {
              sessionId: scriptSession.id,
              traceId: "trace-script-finalize-asset",
            },
          },
        } as Parameters<typeof processScriptFinalizeJob>[0]);

        expect(secondRun.scriptVersionId).toBe(firstRun.scriptVersionId);
        await expect(
          prisma.asset.count({
            where: {
              projectId: project.id,
              category: AssetCategory.SCRIPT_GENERATED,
              metadata: {
                path: ["scriptVersionId"],
                equals: firstRun.scriptVersionId,
              },
            },
          }),
        ).resolves.toBe(1);

        const backfillResult = await backfillAssetCenter({ prisma });
        expect(
          backfillResult.createdAssets.filter(
            (asset) =>
              asset.projectId === project.id &&
              asset.category === AssetCategory.SCRIPT_GENERATED,
          ),
        ).toHaveLength(0);
          },
          {
            STORAGE_ROOT: storageRoot,
          },
        );
      });
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("freezes the session after finalize accepts and blocks answer and regenerate requests", async () => {
    enqueueTaskMock.mockResolvedValueOnce({
      jobId: "job-script-finalize-freeze",
      queueName: "script-queue",
    });

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "script-session-finalize-freeze");
        const session = await insertSessionForUser(prisma, user.id);
        const project = await createProjectWithProvider(prisma, user.id, "finalize-freeze");
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
            ],
          },
        });
        const { POST: finalizePost } = await loadRouteModule<{
          POST: (
            request: Request,
            context: { params: Promise<{ sessionId: string }> | { sessionId: string } },
          ) => Promise<Response>;
        }>("src/app/api/script/sessions/[sessionId]/finalize/route.ts", {
          sessionToken: session.token,
        });
        const { POST: answerPost } = await loadRouteModule<{
          POST: (
            request: Request,
            context: { params: Promise<{ sessionId: string }> | { sessionId: string } },
          ) => Promise<Response>;
        }>("src/app/api/script/sessions/[sessionId]/message/route.ts", {
          sessionToken: session.token,
        });
        const { POST: regeneratePost } = await loadRouteModule<{
          POST: (
            request: Request,
            context: { params: Promise<{ sessionId: string }> | { sessionId: string } },
          ) => Promise<Response>;
        }>("src/app/api/script/sessions/[sessionId]/regenerate/route.ts", {
          sessionToken: session.token,
        });

        const finalizeResponse = await finalizePost(
          jsonRequest(
            `http://localhost/api/script/sessions/${scriptSession.id}/finalize`,
            undefined,
            { method: "POST" },
          ),
          { params: { sessionId: scriptSession.id } },
        );

        expect(finalizeResponse.status).toBe(202);
        await expect(
          prisma.scriptSession.findUniqueOrThrow({
            where: { id: scriptSession.id },
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            id: scriptSession.id,
            status: "FINALIZING",
          }),
        );

        const answerResponse = await answerPost(
          jsonRequest(
            `http://localhost/api/script/sessions/${scriptSession.id}/message`,
            {
              answer: "One more answer.",
            },
            { method: "POST" },
          ),
          { params: { sessionId: scriptSession.id } },
        );
        const regenerateResponse = await regeneratePost(
          jsonRequest(
            `http://localhost/api/script/sessions/${scriptSession.id}/regenerate`,
            undefined,
            { method: "POST" },
          ),
          { params: { sessionId: scriptSession.id } },
        );

        expect(answerResponse.status).toBe(409);
        await expect(answerResponse.json()).resolves.toEqual({
          error: "Script session is finalizing",
        });
        expect(regenerateResponse.status).toBe(409);
        await expect(regenerateResponse.json()).resolves.toEqual({
          error: "Script session is finalizing",
        });
        expect(streamProxyModelMock).not.toHaveBeenCalled();
      });
    });
  });

  it("rejects a duplicate finalize request after the first request freezes the session", async () => {
    const enqueueStarted = createDeferred<void>();
    const enqueueRelease = createDeferred<{
      jobId: string;
      queueName: string;
    }>();
    enqueueTaskMock.mockImplementationOnce(async () => {
      enqueueStarted.resolve();
      return enqueueRelease.promise;
    });

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "script-session-finalize-dup");
        const project = await createProjectWithProvider(prisma, user.id, "finalize-dup");
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
            ],
          },
        });
        const { finalizeScriptSession } = await loadRouteModule<
          typeof import("../../../src/lib/services/script-sessions")
        >("src/lib/services/script-sessions.ts");

        const firstFinalize = finalizeScriptSession(scriptSession.id, user.id);
        await enqueueStarted.promise;

        await expect(
          finalizeScriptSession(scriptSession.id, user.id),
        ).rejects.toMatchObject({
          status: 409,
          message: "Script finalize task is already in progress",
        });

        enqueueRelease.resolve({
          jobId: "job-script-finalize",
          queueName: "script-queue",
        });

        await expect(firstFinalize).resolves.toEqual({
          taskId: expect.any(String),
        });
        expect(enqueueTaskMock).toHaveBeenCalledTimes(1);
        await expect(
          prisma.task.count({
            where: {
              projectId: project.id,
              createdById: user.id,
              type: TaskType.SCRIPT_FINALIZE,
            },
          }),
        ).resolves.toBe(1);
      });
    });
  });

  it("restores the session to ACTIVE and deletes the queued task when finalize enqueueing fails", async () => {
    enqueueTaskMock.mockRejectedValueOnce(new Error("queue unavailable"));

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "script-session-finalize-enqueue-fail");
        const project = await createProjectWithProvider(prisma, user.id, "finalize-enqueue-fail");
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
            ],
          },
        });
        const { finalizeScriptSession } = await loadRouteModule<
          typeof import("../../../src/lib/services/script-sessions")
        >("src/lib/services/script-sessions.ts");

        await expect(
          finalizeScriptSession(scriptSession.id, user.id),
        ).rejects.toThrow("queue unavailable");

        await expect(
          prisma.scriptSession.findUniqueOrThrow({
            where: { id: scriptSession.id },
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            id: scriptSession.id,
            status: ScriptSessionStatus.ACTIVE,
          }),
        );
        await expect(
          prisma.task.count({
            where: {
            projectId: project.id,
            createdById: user.id,
            type: TaskType.SCRIPT_FINALIZE,
          },
        }),
        ).resolves.toBe(0);
      });
    });
  });

  it("does not accumulate orphaned finalize tasks when retrying after an enqueue failure", async () => {
    enqueueTaskMock
      .mockRejectedValueOnce(new Error("queue unavailable"))
      .mockResolvedValueOnce({
        jobId: "job-script-finalize-retry",
        queueName: "script-queue",
      });

    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "script-session-finalize-retry-clean");
        const project = await createProjectWithProvider(prisma, user.id, "finalize-retry-clean");
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
            ],
          },
        });
        const { finalizeScriptSession } = await loadRouteModule<
          typeof import("../../../src/lib/services/script-sessions")
        >("src/lib/services/script-sessions.ts");

        await expect(
          finalizeScriptSession(scriptSession.id, user.id),
        ).rejects.toThrow("queue unavailable");

        await expect(
          finalizeScriptSession(scriptSession.id, user.id),
        ).resolves.toEqual({
          taskId: expect.any(String),
        });

        expect(enqueueTaskMock).toHaveBeenCalledTimes(2);
        await expect(
          prisma.task.count({
            where: {
              projectId: project.id,
              createdById: user.id,
              type: TaskType.SCRIPT_FINALIZE,
            },
          }),
        ).resolves.toBe(1);
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
