import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { rm } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  TaskStatus,
  TaskType,
  UserRole,
  UserStatus,
} from "@prisma/client";
import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/ai_short_drama";
const storageRoot = process.env.STORAGE_ROOT
  ? path.resolve(process.env.STORAGE_ROOT)
  : path.resolve("storage");

const ONE_BY_ONE_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7GZxkAAAAASUVORK5CYII=",
  "base64",
);
const ONE_BY_ONE_PNG_DATA_URL = `data:image/png;base64,${ONE_BY_ONE_PNG_BYTES.toString("base64")}`;
const SAMPLE_MP4_BYTES = Buffer.from("000000186674797069736F6D0000020069736F6D69736F32", "hex");
const SAMPLE_MP4_DATA_URL = `data:video/mp4;base64,${SAMPLE_MP4_BYTES.toString("base64")}`;
const RETRY_VIDEO_PROMPT = "FAIL_FOR_ADMIN_RETRY";
const CANCEL_VIDEO_PROMPT = "WAIT_FOR_ADMIN_CANCEL";
const PROVIDER_MODELS = {
  script: "fake-script-model",
  storyboard: "fake-storyboard-model",
  image: "fake-image-model",
  video: "fake-video-model",
} as const;

type ProviderKeys = {
  script: string;
  storyboard: string;
  image: string;
  video: string;
};

type ProxyExpectations = {
  projectId: string;
  userId: string;
  scriptSessionId: string;
  scriptVersionId: string;
  referenceAssetId: string;
};

type FakeProxyPayload = {
  taskType?: unknown;
  providerKey?: unknown;
  model?: unknown;
  inputText?: unknown;
  inputFiles?: unknown;
  options?: unknown;
  traceId?: unknown;
};

function createPrismaClient() {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function readTrimmedString(value: unknown, field: string) {
  assertCondition(typeof value === "string" && value.trim().length > 0, `${field} must be a non-empty string`);
  return value.trim();
}

function readStringArray(value: unknown, field: string) {
  assertCondition(Array.isArray(value), `${field} must be an array`);
  return value.map((entry, index) => readTrimmedString(entry, `${field}[${index}]`));
}

function readObjectRecord(value: unknown, field: string) {
  assertCondition(value && typeof value === "object" && !Array.isArray(value), `${field} must be an object`);
  return value as Record<string, unknown>;
}

function readHeaderValue(headers: Record<string, string | string[] | undefined>, name: string) {
  const rawValue = headers[name];
  return Array.isArray(rawValue) ? rawValue[0] : rawValue;
}

function validateCommonRequest(input: {
  headers: Record<string, string | string[] | undefined>;
  payload: FakeProxyPayload;
  expectedTaskType: string;
  expectedProviderKey: string;
  expectedModel: string;
}) {
  const traceId = readTrimmedString(input.payload.traceId, "traceId");
  const headerTraceId = readTrimmedString(
    readHeaderValue(input.headers, "x-trace-id"),
    "x-trace-id",
  );
  const headerProviderKey = readTrimmedString(
    readHeaderValue(input.headers, "x-provider-key"),
    "x-provider-key",
  );

  assertCondition(traceId === headerTraceId, "traceId must match x-trace-id");
  assertCondition(
    readTrimmedString(input.payload.taskType, "taskType") === input.expectedTaskType,
    `taskType must be ${input.expectedTaskType}`,
  );
  assertCondition(
    readTrimmedString(input.payload.providerKey, "providerKey") === input.expectedProviderKey,
    `providerKey must be ${input.expectedProviderKey}`,
  );
  assertCondition(
    headerProviderKey === input.expectedProviderKey,
    `x-provider-key must be ${input.expectedProviderKey}`,
  );
  assertCondition(
    readTrimmedString(input.payload.model, "model") === input.expectedModel,
    `model must be ${input.expectedModel}`,
  );
}

function assertEmptyInputFiles(payload: FakeProxyPayload, taskType: string) {
  const inputFiles = readStringArray(payload.inputFiles, `${taskType}.inputFiles`);
  assertCondition(inputFiles.length === 0, `${taskType} must not send inputFiles`);
}

function assertSingleDataUrlInputFile(payload: FakeProxyPayload, taskType: string, prefix: string) {
  const inputFiles = readStringArray(payload.inputFiles, `${taskType}.inputFiles`);
  assertCondition(inputFiles.length === 1, `${taskType} must send exactly one input file`);
  assertCondition(
    inputFiles[0].startsWith(prefix),
    `${taskType} input file must start with ${prefix}`,
  );
}

async function startWorkerProcess() {
  const child =
    process.platform === "win32"
      ? spawn(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", "pnpm exec tsx src/worker/cli.ts"],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              DATABASE_URL: databaseUrl,
              REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        )
      : spawn("pnpm", ["exec", "tsx", "src/worker/cli.ts"], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            DATABASE_URL: databaseUrl,
            REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
          },
          stdio: ["ignore", "pipe", "pipe"],
        });

  let startupBuffer = "";

  await new Promise<void>((resolve, reject) => {
    const handleStdout = (chunk: Buffer | string) => {
      startupBuffer += chunk.toString();
      if (startupBuffer.includes("[worker] started video-queue")) {
        cleanup();
        resolve();
      }
    };

    const handleStderr = (chunk: Buffer | string) => {
      startupBuffer += chunk.toString();
    };

    const handleExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Worker process exited before startup (code ${code ?? "unknown"})\n${startupBuffer}`));
    };

    const cleanup = () => {
      child.stdout.off("data", handleStdout);
      child.stderr.off("data", handleStderr);
      child.off("exit", handleExit);
    };

    child.stdout.on("data", handleStdout);
    child.stderr.on("data", handleStderr);
    child.on("exit", handleExit);
  });

  return {
    close: async () => {
      if (child.exitCode !== null) {
        return;
      }

      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());

        if (process.platform === "win32") {
          const killer = spawn(process.env.ComSpec ?? "cmd.exe", [
            "/d",
            "/s",
            "/c",
            `taskkill /PID ${child.pid} /T /F`,
          ]);
          killer.once("exit", () => undefined);
          return;
        }

        child.kill("SIGTERM");
      });
    },
  };
}

function getTaskPrompt(inputJson: unknown) {
  if (!inputJson || typeof inputJson !== "object" || Array.isArray(inputJson)) {
    return null;
  }

  const prompt = (inputJson as Record<string, unknown>).prompt;
  return typeof prompt === "string" ? prompt : null;
}

async function findTaskByTypeAfter(
  prisma: PrismaClient,
  input: {
    projectId: string;
    createdById: string;
    type: TaskType;
    createdAfter: Date;
  },
) {
  return prisma.task.findFirst({
    where: {
      projectId: input.projectId,
      createdById: input.createdById,
      type: input.type,
      createdAt: {
        gte: input.createdAfter,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      status: true,
      errorText: true,
      createdAt: true,
      inputJson: true,
      outputJson: true,
      cancelRequestedAt: true,
    },
  });
}

async function findVideoTaskByPromptAfter(
  prisma: PrismaClient,
  input: {
    projectId: string;
    createdById: string;
    prompt: string;
    createdAfter: Date;
  },
) {
  const tasks = await prisma.task.findMany({
    where: {
      projectId: input.projectId,
      createdById: input.createdById,
      type: TaskType.VIDEO,
      createdAt: {
        gte: input.createdAfter,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      status: true,
      errorText: true,
      createdAt: true,
      inputJson: true,
      outputJson: true,
      cancelRequestedAt: true,
    },
  });

  return tasks.find((task) => getTaskPrompt(task.inputJson) === input.prompt) ?? null;
}

async function waitForTaskStatus(
  prisma: PrismaClient,
  input: {
    taskId: string;
    expectedStatus: TaskStatus;
    timeoutMs?: number;
  },
) {
  await expect
    .poll(
      async () => {
        const task = await prisma.task.findUnique({
          where: {
            id: input.taskId,
          },
          select: {
            status: true,
          },
        });

        return task?.status ?? null;
      },
      {
        timeout: input.timeoutMs ?? 20_000,
      },
    )
    .toBe(input.expectedStatus);
}

async function withTemporaryProvider<T>(
  prisma: PrismaClient,
  input: {
    key: string;
    label: string;
    modelName: string;
    defaultForTasks: string[];
    baseUrl: string;
  },
  callback: () => Promise<T>,
) {
  await prisma.modelProvider.create({
    data: {
      key: input.key,
      label: input.label,
      providerName: "fake-proxy",
      modelName: input.modelName,
      baseUrl: input.baseUrl,
      timeoutMs: 20_000,
      maxRetries: 0,
      enabled: true,
      configJson: {
        defaultForTasks: input.defaultForTasks,
      },
    },
  });

  try {
    return await callback();
  } finally {
    await prisma.modelProvider.deleteMany({
      where: {
        key: input.key,
      },
    });
  }
}

async function startFakeProxyServer(input: {
  providerKeys: ProviderKeys;
  expected: ProxyExpectations;
}) {
  const retryAttemptsByPrompt = new Map<string, number>();
  let scriptQuestionCount = 0;
  let releaseCancelVideo: (() => void) | null = null;
  let cancelVideoPromise = Promise.resolve();

  function resetCancelGate() {
    cancelVideoPromise = new Promise<void>((resolve) => {
      releaseCancelVideo = resolve;
    });
  }

  resetCancelGate();

  const server = createServer(async (request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405, { "content-type": "application/json" });
      response.end(JSON.stringify({ errorMessage: "Method not allowed" }));
      return;
    }

    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as FakeProxyPayload;
      const taskType = readTrimmedString(payload.taskType, "taskType");
      const headers = request.headers;

      if (taskType === "script_question_generate") {
        validateCommonRequest({
          headers,
          payload,
          expectedTaskType: "script_question_generate",
          expectedProviderKey: input.providerKeys.script,
          expectedModel: PROVIDER_MODELS.script,
        });
        assertEmptyInputFiles(payload, taskType);

        const options = readObjectRecord(payload.options, "options");
        const sessionId = readTrimmedString(options.sessionId, "options.sessionId");
        const projectId = readTrimmedString(options.projectId, "options.projectId");
        const mode = readTrimmedString(options.mode, "options.mode");
        const inputText = readTrimmedString(payload.inputText, "inputText");

        assertCondition(projectId === input.expected.projectId, "script_question_generate projectId mismatch");
        assertCondition(inputText.includes("Session idea:"), "script_question_generate prompt is missing session idea");

        if (input.expected.scriptSessionId) {
          assertCondition(sessionId === input.expected.scriptSessionId, "script_question_generate sessionId mismatch");
        } else {
          input.expected.scriptSessionId = sessionId;
        }

        const expectedMode = scriptQuestionCount === 0 ? "start" : "next";
        assertCondition(mode === expectedMode, `script_question_generate mode must be ${expectedMode}`);

        const question =
          scriptQuestionCount === 0 ? "Who is the protagonist?" : "What is at stake?";
        scriptQuestionCount += 1;

        response.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-cache",
        });
        const midpoint = Math.max(1, Math.floor(question.length / 2));
        response.write(question.slice(0, midpoint));
        setTimeout(() => {
          response.end(question.slice(midpoint));
        }, 30);
        return;
      }

      if (taskType === "script_finalize") {
        validateCommonRequest({
          headers,
          payload,
          expectedTaskType: "script_finalize",
          expectedProviderKey: input.providerKeys.script,
          expectedModel: PROVIDER_MODELS.script,
        });
        assertEmptyInputFiles(payload, taskType);

        const options = readObjectRecord(payload.options, "options");
        assertCondition(
          readTrimmedString(options.projectId, "options.projectId") === input.expected.projectId,
          "script_finalize projectId mismatch",
        );
        assertCondition(
          readTrimmedString(options.sessionId, "options.sessionId") === input.expected.scriptSessionId,
          "script_finalize sessionId mismatch",
        );
        assertCondition(
          readTrimmedString(payload.inputText, "inputText").includes("Return only the completed script body."),
          "script_finalize prompt is missing finalization instruction",
        );

        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            status: "ok",
            textOutput: "INT. ARCHIVE ROOM - NIGHT\nA courier unlocks the memory vault.",
          }),
        );
        return;
      }

      if (taskType === "storyboard_split") {
        validateCommonRequest({
          headers,
          payload,
          expectedTaskType: "storyboard_split",
          expectedProviderKey: input.providerKeys.storyboard,
          expectedModel: PROVIDER_MODELS.storyboard,
        });
        assertEmptyInputFiles(payload, taskType);

        const options = readObjectRecord(payload.options, "options");
        assertCondition(
          readTrimmedString(options.projectId, "options.projectId") === input.expected.projectId,
          "storyboard_split projectId mismatch",
        );
        assertCondition(
          readTrimmedString(options.scriptVersionId, "options.scriptVersionId") === input.expected.scriptVersionId,
          "storyboard_split scriptVersionId mismatch",
        );
        assertCondition(
          readTrimmedString(options.userId, "options.userId") === input.expected.userId,
          "storyboard_split userId mismatch",
        );
        assertCondition(
          readTrimmedString(payload.inputText, "inputText").includes("Script body:"),
          "storyboard_split prompt is missing script body",
        );

        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            status: "ok",
            textOutput: JSON.stringify([
              {
                index: 1,
                durationSeconds: 15,
                scene: "Archive room",
                shot: "Wide",
                action: "The courier studies the glowing lock.",
                dialogue: "",
                videoPrompt: "Slow push toward the vault door.",
              },
              {
                index: 2,
                durationSeconds: 15,
                scene: "Vault chamber",
                shot: "Close",
                action: "Memory reels begin to spin.",
                dialogue: "",
                videoPrompt: "Track across rows of luminous reels.",
              },
            ]),
          }),
        );
        return;
      }

      if (taskType === "image_generate") {
        validateCommonRequest({
          headers,
          payload,
          expectedTaskType: "image_generate",
          expectedProviderKey: input.providerKeys.image,
          expectedModel: PROVIDER_MODELS.image,
        });
        assertEmptyInputFiles(payload, taskType);

        const options = readObjectRecord(payload.options, "options");
        assertCondition(
          readTrimmedString(options.projectId, "options.projectId") === input.expected.projectId,
          "image_generate projectId mismatch",
        );
        assertCondition(
          readTrimmedString(options.userId, "options.userId") === input.expected.userId,
          "image_generate userId mismatch",
        );
        assertCondition(!("sourceAssetId" in options), "image_generate must not send sourceAssetId");
        readTrimmedString(payload.inputText, "inputText");

        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            status: "ok",
            fileOutputs: [ONE_BY_ONE_PNG_DATA_URL],
          }),
        );
        return;
      }

      if (taskType === "image_edit") {
        validateCommonRequest({
          headers,
          payload,
          expectedTaskType: "image_edit",
          expectedProviderKey: input.providerKeys.image,
          expectedModel: PROVIDER_MODELS.image,
        });
        assertSingleDataUrlInputFile(payload, taskType, "data:image/");

        const options = readObjectRecord(payload.options, "options");
        assertCondition(
          readTrimmedString(options.projectId, "options.projectId") === input.expected.projectId,
          "image_edit projectId mismatch",
        );
        assertCondition(
          readTrimmedString(options.userId, "options.userId") === input.expected.userId,
          "image_edit userId mismatch",
        );
        readTrimmedString(options.sourceAssetId, "options.sourceAssetId");
        readTrimmedString(payload.inputText, "inputText");

        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            status: "ok",
            fileOutputs: [ONE_BY_ONE_PNG_DATA_URL],
          }),
        );
        return;
      }

      if (taskType === "video_generate") {
        validateCommonRequest({
          headers,
          payload,
          expectedTaskType: "video_generate",
          expectedProviderKey: input.providerKeys.video,
          expectedModel: PROVIDER_MODELS.video,
        });
        assertSingleDataUrlInputFile(payload, taskType, "data:image/");

        const options = readObjectRecord(payload.options, "options");
        assertCondition(
          readTrimmedString(options.projectId, "options.projectId") === input.expected.projectId,
          "video_generate projectId mismatch",
        );
        assertCondition(
          readTrimmedString(options.userId, "options.userId") === input.expected.userId,
          "video_generate userId mismatch",
        );
        const referenceAssetIds = readStringArray(options.referenceAssetIds, "options.referenceAssetIds");
        assertCondition(referenceAssetIds.length === 1, "video_generate must send exactly one referenceAssetId");
        assertCondition(
          referenceAssetIds[0] === input.expected.referenceAssetId,
          "video_generate referenceAssetId mismatch",
        );

        const prompt = readTrimmedString(payload.inputText, "inputText");
        if (prompt === RETRY_VIDEO_PROMPT) {
          const attempt = (retryAttemptsByPrompt.get(prompt) ?? 0) + 1;
          retryAttemptsByPrompt.set(prompt, attempt);

          if (attempt <= 2) {
            response.writeHead(500, { "content-type": "application/json" });
            response.end(
              JSON.stringify({
                status: "error",
                errorMessage: "Forced video failure for admin retry",
              }),
            );
            return;
          }
        }

        if (prompt === CANCEL_VIDEO_PROMPT) {
          await cancelVideoPromise;
          resetCancelGate();
        }

        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            status: "ok",
            fileOutputs: [SAMPLE_MP4_DATA_URL],
          }),
        );
        return;
      }

      response.writeHead(400, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          status: "error",
          errorMessage: `Unsupported taskType: ${taskType}`,
        }),
      );
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          status: "error",
          errorMessage: error instanceof Error ? error.message : "Invalid fake provider request",
        }),
      );
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    releaseCancelVideo: () => {
      releaseCancelVideo?.();
    },
    close: async () => {
      releaseCancelVideo?.();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

test("full smoke uses real UI, app routes, queues, workers, and fake providers", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const prisma = createPrismaClient();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const adminUsername = `admin-smoke-${suffix}`;
  const requesterUsername = `writer-smoke-${suffix}`;
  const adminPassword = "AdminPass123!";
  const finalPassword = "WriterPass123!";
  const projectTitle = `Smoke Project ${suffix}`;
  const projectIdea = "Build a complete short-drama project through every workflow.";
  const providerKeys: ProviderKeys = {
    script: `e2e-script-${suffix}`,
    storyboard: `e2e-storyboard-${suffix}`,
    image: `e2e-image-${suffix}`,
    video: `e2e-video-${suffix}`,
  };
  const providerExpectations: ProxyExpectations = {
    projectId: "",
    userId: "",
    scriptSessionId: "",
    scriptVersionId: "",
    referenceAssetId: "",
  };

  let fakeProxy: Awaited<ReturnType<typeof startFakeProxyServer>> | null = null;
  let workerRuntime: { close: () => Promise<void> } | null = null;
  let userId = "";
  let projectId = "";
  let happyImageAssetId = "";

  try {
    fakeProxy = await startFakeProxyServer({
      providerKeys,
      expected: providerExpectations,
    });

    await prisma.accountRequest.deleteMany({
      where: {
        username: requesterUsername,
      },
    });
    await prisma.user.deleteMany({
      where: {
        username: {
          in: [adminUsername, requesterUsername],
        },
      },
    });

    await prisma.user.create({
      data: {
        username: adminUsername,
        passwordHash: await hash(adminPassword, 12),
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        forcePasswordChange: false,
      },
    });

    workerRuntime = await startWorkerProcess();

    await page.goto("/register-request");
    await page.locator("form input").nth(0).fill(requesterUsername);
    await page.locator("form input").nth(1).fill(`Writer ${suffix}`);
    await page.locator("form textarea").fill("Need access to create and review short-drama projects");
    const registerResponsePromise = page.waitForResponse((response) => {
      return (
        response.url().includes("/api/auth/register-request") &&
        response.request().method() === "POST"
      );
    });
    await page.locator('button[type="submit"]').click();
    const registerResponse = await registerResponsePromise;
    expect(registerResponse.ok()).toBe(true);

    await expect(
      prisma.accountRequest.findUniqueOrThrow({
        where: {
          username: requesterUsername,
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        username: requesterUsername,
        status: "PENDING",
      }),
    );

    await page.goto("/login");
    await page.locator('input[autocomplete="username"]').fill(adminUsername);
    await page.locator('input[autocomplete="current-password"]').fill(adminPassword);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/admin\/users$/);

    const requestCard = page.locator("article").filter({ hasText: requesterUsername }).first();
    const approvalResponsePromise = page.waitForResponse((response) => {
      return (
        response.url().includes("/api/admin/account-requests") &&
        response.request().method() === "POST"
      );
    });
    await requestCard.getByRole("button").first().click();
    const approvalResponse = await approvalResponsePromise;
    expect(approvalResponse.ok()).toBe(true);
    const approvalPayload = (await approvalResponse.json()) as {
      tempPassword: string;
      userId: string;
    };
    userId = approvalPayload.userId;
    providerExpectations.userId = userId;

    await page.context().clearCookies();
    await page.goto("/login");
    await page.locator('input[autocomplete="username"]').fill(requesterUsername);
    await page.locator('input[autocomplete="current-password"]').fill(approvalPayload.tempPassword);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/force-password$/);

    await page.locator('input[autocomplete="new-password"]').nth(0).fill(finalPassword);
    await page.locator('input[autocomplete="new-password"]').nth(1).fill(finalPassword);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/workspace$/);

    const createProjectCard = page.locator("article").filter({ has: page.locator("textarea") }).first();
    await createProjectCard.getByRole("textbox").nth(0).fill(projectTitle);
    await createProjectCard.getByRole("textbox").nth(1).fill(projectIdea);
    await createProjectCard.getByRole("button").click();
    await expect(page).toHaveURL(/\/projects\/[^/]+$/);
    projectId = new URL(page.url()).pathname.split("/").pop() ?? "";
    providerExpectations.projectId = projectId;
    await expect(page.getByRole("heading", { name: projectTitle })).toBeVisible();

    await withTemporaryProvider(
      prisma,
      {
        key: providerKeys.script,
        label: "E2E Script Provider",
        modelName: PROVIDER_MODELS.script,
        defaultForTasks: ["script_question_generate", "script_finalize"],
        baseUrl: fakeProxy.baseUrl,
      },
      async () => {
        await page.goto(`/projects/${projectId}/script`);
        await expect(page.getByRole("heading", { name: /^脚本$/ })).toBeVisible();
        await expect(page.getByRole("link", { name: "返回项目制作台" })).toHaveAttribute(
          "href",
          `/projects/${projectId}`,
        );
        await expect(page.getByText("项目制作流程")).toHaveCount(2);
        await page.getByLabel("Script idea input").fill(
          "A courier discovers a vault that can rewrite every memory in the city.",
        );
        await page.getByRole("button", { name: "Start script session" }).click();
        await expect(page.getByText("Who is the protagonist?")).toBeVisible();
        await page.getByLabel("Script answer input").fill("A courier who smuggles forbidden memories.");
        await page.getByRole("button", { name: "Send script answer" }).click();
        await expect(page.getByText("What is at stake?")).toBeVisible();

        const scriptSubmittedAt = new Date();
        await page.getByRole("button", { name: "Finalize script" }).click();
        await expect(page.getByText("INT. ARCHIVE ROOM - NIGHT")).toBeVisible({ timeout: 15_000 });

        await expect
          .poll(
            async () => {
              const task = await findTaskByTypeAfter(prisma, {
                projectId,
                createdById: userId,
                type: TaskType.SCRIPT_FINALIZE,
                createdAfter: scriptSubmittedAt,
              });
              return task?.status ?? null;
            },
            { timeout: 15_000 },
          )
          .toBe(TaskStatus.SUCCEEDED);

        const scriptVersion = await prisma.scriptVersion.findFirstOrThrow({
          where: {
            projectId,
            scriptSessionId: providerExpectations.scriptSessionId,
          },
          orderBy: {
            versionNumber: "desc",
          },
          select: {
            id: true,
          },
        });
        providerExpectations.scriptVersionId = scriptVersion.id;
      },
    );

    await withTemporaryProvider(
      prisma,
      {
        key: providerKeys.storyboard,
        label: "E2E Storyboard Provider",
        modelName: PROVIDER_MODELS.storyboard,
        defaultForTasks: ["storyboard_split"],
        baseUrl: fakeProxy.baseUrl,
      },
      async () => {
        await page.goto(`/projects/${projectId}/storyboard`);
        await expect(page.getByRole("heading", { name: /^分镜$/ })).toBeVisible();
        await expect(page.getByRole("link", { name: "返回项目制作台" })).toHaveAttribute(
          "href",
          `/projects/${projectId}`,
        );
        const storyboardSubmittedAt = new Date();
        await page.getByText("生成分镜").click();
        await expect(page.getByText("分镜已生成。")).toBeVisible({ timeout: 15_000 });

        await expect
          .poll(
            async () => {
              const task = await findTaskByTypeAfter(prisma, {
                projectId,
                createdById: userId,
                type: TaskType.STORYBOARD,
                createdAfter: storyboardSubmittedAt,
              });
              return task?.status ?? null;
            },
            { timeout: 15_000 },
          )
          .toBe(TaskStatus.SUCCEEDED);
      },
    );

    await withTemporaryProvider(
      prisma,
      {
        key: providerKeys.image,
        label: "E2E Image Provider",
        modelName: PROVIDER_MODELS.image,
        defaultForTasks: ["image_generate", "image_edit"],
        baseUrl: fakeProxy.baseUrl,
      },
      async () => {
        await page.goto(`/projects/${projectId}/images`);
        await expect(page.getByRole("heading", { name: /^图片$/ })).toBeVisible();
        await expect(page.getByRole("link", { name: "返回项目制作台" })).toHaveAttribute(
          "href",
          `/projects/${projectId}`,
        );
        const imageSubmittedAt = new Date();
        await page.getByLabel("Image prompt input").fill("Generate a cinematic still of the courier.");
        await page.getByText("生成图片").click();
        await expect(page.getByText("图片已生成。")).toBeVisible({ timeout: 15_000 });

        let imageTaskId = "";
        await expect
          .poll(
            async () => {
              const task = await findTaskByTypeAfter(prisma, {
                projectId,
                createdById: userId,
                type: TaskType.IMAGE,
                createdAfter: imageSubmittedAt,
              });
              imageTaskId = task?.id ?? "";
              return task?.status ?? null;
            },
            { timeout: 15_000 },
          )
          .toBe(TaskStatus.SUCCEEDED);

        const imageAsset = await prisma.asset.findFirstOrThrow({
          where: {
            taskId: imageTaskId,
          },
          select: {
            id: true,
          },
        });
        happyImageAssetId = imageAsset.id;
        providerExpectations.referenceAssetId = imageAsset.id;
        await expect(page.getByText(happyImageAssetId)).toBeVisible();
      },
    );

    let scriptTaskId = "";
    let storyboardTaskId = "";
    await expect
      .poll(
        async () => {
          const [scriptTask, storyboardTask] = await Promise.all([
            prisma.task.findFirst({
              where: {
                projectId,
                createdById: userId,
                type: TaskType.SCRIPT_FINALIZE,
              },
              orderBy: {
                createdAt: "desc",
              },
              select: {
                id: true,
              },
            }),
            prisma.task.findFirst({
              where: {
                projectId,
                createdById: userId,
                type: TaskType.STORYBOARD,
              },
              orderBy: {
                createdAt: "desc",
              },
              select: {
                id: true,
              },
            }),
          ]);
          scriptTaskId = scriptTask?.id ?? "";
          storyboardTaskId = storyboardTask?.id ?? "";
          return Boolean(scriptTaskId && storyboardTaskId);
        },
        { timeout: 10_000 },
      )
      .toBe(true);

    await withTemporaryProvider(
      prisma,
      {
        key: providerKeys.video,
        label: "E2E Video Provider",
        modelName: PROVIDER_MODELS.video,
        defaultForTasks: ["video_generate"],
        baseUrl: fakeProxy.baseUrl,
      },
      async () => {
        await page.goto(`/projects/${projectId}/videos`);
        await expect(page.getByRole("heading", { name: /^视频$/ })).toBeVisible();
        await expect(page.getByRole("link", { name: "返回项目制作台" })).toHaveAttribute(
          "href",
          `/projects/${projectId}`,
        );
        await page.getByLabel("Video prompt input").fill("Animate the still with a slow push-in.");
        await page.getByRole("button", { name: new RegExp(happyImageAssetId) }).click();
        const happyVideoSubmittedAt = new Date();
        await page.getByRole("button").filter({ hasText: "生成视频" }).click();
        await expect(page.getByText("视频已生成。")).toBeVisible({ timeout: 15_000 });

        let happyVideoTaskId = "";
        await expect
          .poll(
            async () => {
              const task = await findTaskByTypeAfter(prisma, {
                projectId,
                createdById: userId,
                type: TaskType.VIDEO,
                createdAfter: happyVideoSubmittedAt,
              });
              happyVideoTaskId = task?.id ?? "";
              return task?.status ?? null;
            },
            { timeout: 15_000 },
          )
          .toBe(TaskStatus.SUCCEEDED);

        const happyVideoAsset = await prisma.asset.findFirstOrThrow({
          where: {
            taskId: happyVideoTaskId,
          },
          select: {
            id: true,
          },
        });

        await page.goto(`/projects/${projectId}`);
        await expect(page.getByRole("heading", { name: "脚本记录" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "分镜记录" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "图片资产" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "视频资产" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "任务历史" })).toBeVisible();
        await expect(page.getByText(happyImageAssetId, { exact: true }).first()).toBeVisible();
        await expect(page.getByText(happyVideoAsset.id, { exact: true }).first()).toBeVisible();
        await expect(page.getByText(scriptTaskId).first()).toBeVisible();
        await expect(page.getByText(storyboardTaskId).first()).toBeVisible();

        await page.goto(`/projects/${projectId}/videos`);
        await page.getByLabel("Video prompt input").fill(RETRY_VIDEO_PROMPT);
        await page.getByRole("button", { name: new RegExp(happyImageAssetId) }).click();
        const failedVideoSubmittedAt = new Date();
        await page.getByRole("button").filter({ hasText: "生成视频" }).click();

        let failedVideoTaskId = "";
        await expect
          .poll(
            async () => {
              const task = await findVideoTaskByPromptAfter(prisma, {
                projectId,
                createdById: userId,
                prompt: RETRY_VIDEO_PROMPT,
                createdAfter: failedVideoSubmittedAt,
              });
              failedVideoTaskId = task?.id ?? "";
              return task?.status ?? null;
            },
            { timeout: 20_000 },
          )
          .toBe(TaskStatus.FAILED);

        await page.goto(`/projects/${projectId}/videos`);
        await page.getByLabel("Video prompt input").fill(CANCEL_VIDEO_PROMPT);
        const referenceButton = page.getByRole("button", { name: new RegExp(happyImageAssetId) });
        await referenceButton.click();
        const cancelVideoSubmittedAt = new Date();
        await expect(page.getByRole("button").filter({ hasText: "生成视频" })).toBeEnabled();
        await page.getByRole("button").filter({ hasText: "生成视频" }).click();

        let cancelVideoTaskId = "";
        await expect
          .poll(
            async () => {
              const task = await findVideoTaskByPromptAfter(prisma, {
                projectId,
                createdById: userId,
                prompt: CANCEL_VIDEO_PROMPT,
                createdAfter: cancelVideoSubmittedAt,
              });
              cancelVideoTaskId = task?.id ?? "";
              return task?.status ?? null;
            },
            { timeout: 10_000 },
          )
          .toBe(TaskStatus.RUNNING);

        await page.context().clearCookies();
        await page.goto("/login");
        await page.locator('input[autocomplete="username"]').fill(adminUsername);
        await page.locator('input[autocomplete="current-password"]').fill(adminPassword);
        await page.locator('button[type="submit"]').click();
        await expect(page).toHaveURL(/\/admin\/users$/);

        await page.goto("/admin/tasks");
        await expect(page.getByRole("heading", { name: "Task Monitoring" })).toBeVisible();

        const failedTaskCard = page.locator("article").filter({ hasText: failedVideoTaskId }).first();
        const retryResponsePromise = page.waitForResponse((response) => {
          return (
            response.url().includes(`/api/admin/tasks/${failedVideoTaskId}/retry`) &&
            response.request().method() === "POST"
          );
        });
        await failedTaskCard.getByRole("button", { name: "Retry task" }).click();
        const retryResponse = await retryResponsePromise;
        expect(retryResponse.status()).toBe(202);
        await waitForTaskStatus(prisma, {
          taskId: failedVideoTaskId,
          expectedStatus: TaskStatus.SUCCEEDED,
          timeoutMs: 20_000,
        });

        const runningTaskCard = page.locator("article").filter({ hasText: cancelVideoTaskId }).first();
        const cancelResponsePromise = page.waitForResponse((response) => {
          return (
            response.url().includes(`/api/admin/tasks/${cancelVideoTaskId}/cancel`) &&
            response.request().method() === "POST"
          );
        });
        await runningTaskCard.getByRole("button", { name: "Cancel task" }).click();
        const cancelResponse = await cancelResponsePromise;
        expect(cancelResponse.status()).toBe(202);
        await expect
          .poll(
            async () => {
              const task = await prisma.task.findUnique({
                where: {
                  id: cancelVideoTaskId,
                },
                select: {
                  cancelRequestedAt: true,
                },
              });

              return Boolean(task?.cancelRequestedAt);
            },
            { timeout: 10_000 },
          )
          .toBe(true);

        fakeProxy?.releaseCancelVideo();
        await waitForTaskStatus(prisma, {
          taskId: cancelVideoTaskId,
          expectedStatus: TaskStatus.CANCELED,
          timeoutMs: 20_000,
        });
      },
    );
  } finally {
    fakeProxy?.releaseCancelVideo();
    await workerRuntime?.close().catch(() => undefined);
    await fakeProxy?.close().catch(() => undefined);

    await prisma.modelProvider.deleteMany({
      where: {
        key: {
          in: Object.values(providerKeys),
        },
      },
    });

    if (projectId) {
      await rm(path.join(storageRoot, "assets", projectId), {
        recursive: true,
        force: true,
      });
    }

    await prisma.accountRequest.deleteMany({
      where: {
        username: requesterUsername,
      },
    });
    await prisma.user.deleteMany({
      where: {
        username: {
          in: [adminUsername, requesterUsername],
        },
      },
    });

    await prisma.$disconnect();
  }
});
