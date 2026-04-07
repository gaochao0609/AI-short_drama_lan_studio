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
import { expect, test, type Page } from "@playwright/test";
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
  storyboard: "fake-storyboard-model",
  image: "fake-image-model",
  video: "fake-video-model",
} as const;

type ProviderKeys = {
  storyboard: string;
  image: string;
  video: string;
};

type ProxyExpectations = {
  projectId: string;
  userId: string;
  storyboardScriptAssetId: string;
  imageReferenceAssetIds: string[];
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

function assertSingleDataUrlInputFile(payload: FakeProxyPayload, taskType: string, prefix: string) {
  const inputFiles = readStringArray(payload.inputFiles, `${taskType}.inputFiles`);
  assertCondition(inputFiles.length === 1, `${taskType} must send exactly one input file`);
  assertCondition(
    inputFiles[0].startsWith(prefix),
    `${taskType} input file must start with ${prefix}`,
  );
}

function readMetadataObject(metadata: unknown) {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }

  return {};
}

async function findProjectAssetByName(
  prisma: PrismaClient,
  input: {
    projectId: string;
    originalName: string;
  },
) {
  return prisma.asset.findFirst({
    where: {
      projectId: input.projectId,
      originalName: input.originalName,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      metadata: true,
    },
  });
}

function assetCard(page: Page, assetId: string) {
  return page.locator(`article[aria-label^="${assetId} "]`);
}

async function openBindingMenu(page: Page, assetId: string) {
  const card = assetCard(page, assetId);
  await expect(card).toHaveCount(1);
  await card.locator("button[aria-expanded]").click();
  return card;
}

async function uploadAssetThroughPicker(
  page: Page,
  input: {
    name: string;
    mimeType: string;
    buffer: Buffer;
  },
) {
  await page.locator('input[type="file"]').setInputFiles({
    name: input.name,
    mimeType: input.mimeType,
    buffer: input.buffer,
  });
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

      if (taskType === "storyboard_split") {
        validateCommonRequest({
          headers,
          payload,
          expectedTaskType: "storyboard_split",
          expectedProviderKey: input.providerKeys.storyboard,
          expectedModel: PROVIDER_MODELS.storyboard,
        });

        const inputFiles = readStringArray(payload.inputFiles, `${taskType}.inputFiles`);
        assertCondition(inputFiles.length === 0, "storyboard_split must not send inputFiles");

        const options = readObjectRecord(payload.options, "options");
        assertCondition(
          readTrimmedString(options.projectId, "options.projectId") === input.expected.projectId,
          "storyboard_split projectId mismatch",
        );
        assertCondition(
          readTrimmedString(options.scriptAssetId, "options.scriptAssetId") ===
            input.expected.storyboardScriptAssetId,
          "storyboard_split scriptAssetId mismatch",
        );
        readTrimmedString(options.scriptVersionId, "options.scriptVersionId");
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
        const inputFiles = readStringArray(payload.inputFiles, `${taskType}.inputFiles`);
        assertCondition(inputFiles.length === 0, "image_generate must not send inputFiles");

        const options = readObjectRecord(payload.options, "options");
        assertCondition(
          readTrimmedString(options.projectId, "options.projectId") === input.expected.projectId,
          "image_generate projectId mismatch",
        );
        assertCondition(
          readTrimmedString(options.userId, "options.userId") === input.expected.userId,
          "image_generate userId mismatch",
        );
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
        const referenceAssetIds = readStringArray(options.referenceAssetIds, "options.referenceAssetIds");
        assertCondition(
          referenceAssetIds.length === input.expected.imageReferenceAssetIds.length,
          "image_edit referenceAssetIds length mismatch",
        );
        assertCondition(
          JSON.stringify(referenceAssetIds) === JSON.stringify(input.expected.imageReferenceAssetIds),
          "image_edit referenceAssetIds mismatch",
        );
        assertCondition(
          readTrimmedString(options.sourceAssetId, "options.sourceAssetId") ===
            input.expected.imageReferenceAssetIds[0],
          "image_edit sourceAssetId mismatch",
        );
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
  const uploadedScriptName = `uploaded-script-${suffix}.md`;
  const uploadedScriptBody = "INT. ARCHIVE ROOM - NIGHT\nA courier unlocks the memory vault.";
  const imageReferenceName = `image-reference-${suffix}.png`;
  const videoReferenceName = `video-reference-${suffix}.png`;
  const providerKeys: ProviderKeys = {
    storyboard: `e2e-storyboard-${suffix}`,
    image: `e2e-image-${suffix}`,
    video: `e2e-video-${suffix}`,
  };
  const providerExpectations: ProxyExpectations = {
    projectId: "",
    userId: "",
    storyboardScriptAssetId: "",
    imageReferenceAssetIds: [],
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
    await page
      .getByRole("textbox", { name: /\u7528\u6237\u540d|username/i })
      .fill(requesterUsername);
    await page
      .getByRole("textbox", { name: /\u663e\u793a\u540d\u79f0|display name/i })
      .fill(`Writer ${suffix}`);
    await page
      .getByRole("textbox", { name: /\u7533\u8bf7\u8bf4\u660e|reason/i })
      .fill("Need access to create and review short-drama projects");
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
    await requestCard.getByRole("button", { name: /\u901a\u8fc7\u7533\u8bf7|\u5ba1\u6279|approve/i }).click();
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

    await page
      .getByLabel(/^\u65b0\u5bc6\u7801$|^new password$/i)
      .fill(finalPassword);
    await page
      .getByLabel(/^\u786e\u8ba4\u65b0\u5bc6\u7801$|^confirm new password$/i)
      .fill(finalPassword);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/workspace$/);

    const createProjectCard = page.locator("article").filter({ has: page.locator("textarea") }).first();
    await createProjectCard
      .getByRole("textbox", { name: /\u9879\u76ee\u540d\u79f0|project title/i })
      .fill(projectTitle);
    await createProjectCard
      .getByRole("textbox", { name: /\u9879\u76ee\u6982\u5ff5|project idea/i })
      .fill(projectIdea);
    await createProjectCard
      .getByRole("button", { name: /\u521b\u5efa\u9879\u76ee\u5e76\u8fdb\u5165\u811a\u672c\u6d41\u7a0b|create project/i })
      .click();
    await expect(page).toHaveURL(/\/projects\/[^/]+$/);
    projectId = new URL(page.url()).pathname.split("/").pop() ?? "";
    providerExpectations.projectId = projectId;
    await expect(page.getByRole("heading", { name: projectTitle })).toBeVisible();

    await page.goto(`/projects/${projectId}/assets`);
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/assets$`));
    await expect(page.locator('input[type="file"]')).toHaveCount(1);

    await uploadAssetThroughPicker(page, {
      name: uploadedScriptName,
      mimeType: "text/markdown",
      buffer: Buffer.from(uploadedScriptBody, "utf8"),
    });

    let uploadedScriptAssetId = "";
    await expect
      .poll(
        async () => {
          const asset = await findProjectAssetByName(prisma, {
            projectId,
            originalName: uploadedScriptName,
          });
          uploadedScriptAssetId = asset?.id ?? "";
          return Boolean(uploadedScriptAssetId);
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    await expect
      .poll(
        async () => {
          const asset = await prisma.asset.findUnique({
            where: {
              id: uploadedScriptAssetId,
            },
            select: {
              metadata: true,
            },
          });

          return readMetadataObject(asset?.metadata).parseStatus ?? null;
        },
        { timeout: 20_000 },
      )
      .toBe("ready");

    await uploadAssetThroughPicker(page, {
      name: imageReferenceName,
      mimeType: "image/png",
      buffer: ONE_BY_ONE_PNG_BYTES,
    });
    await uploadAssetThroughPicker(page, {
      name: videoReferenceName,
      mimeType: "image/png",
      buffer: ONE_BY_ONE_PNG_BYTES,
    });

    let uploadedImageReferenceId = "";
    let uploadedVideoReferenceId = "";
    await expect
      .poll(
        async () => {
          const [imageReferenceAsset, videoReferenceAsset] = await Promise.all([
            findProjectAssetByName(prisma, {
              projectId,
              originalName: imageReferenceName,
            }),
            findProjectAssetByName(prisma, {
              projectId,
              originalName: videoReferenceName,
            }),
          ]);
          uploadedImageReferenceId = imageReferenceAsset?.id ?? "";
          uploadedVideoReferenceId = videoReferenceAsset?.id ?? "";
          return Boolean(uploadedImageReferenceId && uploadedVideoReferenceId);
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    providerExpectations.storyboardScriptAssetId = uploadedScriptAssetId;
    providerExpectations.imageReferenceAssetIds = [uploadedImageReferenceId];
    providerExpectations.referenceAssetId = uploadedVideoReferenceId;

    await page.reload();
    await expect(page.getByText(uploadedScriptName).first()).toBeVisible();
    await expect(page.getByText(imageReferenceName).first()).toBeVisible();
    await expect(page.getByText(videoReferenceName).first()).toBeVisible();

    const uploadedScriptCard = await openBindingMenu(page, uploadedScriptAssetId);
    await uploadedScriptCard.locator(`button[aria-label^="${uploadedScriptAssetId} "]`).first().click();

    const imageReferenceCard = await openBindingMenu(page, uploadedImageReferenceId);
    await imageReferenceCard.locator(`button[aria-label^="${uploadedImageReferenceId} "]`).nth(0).click();

    const videoReferenceCard = await openBindingMenu(page, uploadedVideoReferenceId);
    await videoReferenceCard.locator(`button[aria-label^="${uploadedVideoReferenceId} "]`).nth(1).click();

    await expect
      .poll(
        async () => {
          const binding = await prisma.projectWorkflowBinding.findUnique({
            where: {
              projectId,
            },
            select: {
              storyboardScriptAssetId: true,
              imageReferenceAssetIds: true,
              videoReferenceAssetIds: true,
            },
          });

          return {
            storyboardScriptAssetId: binding?.storyboardScriptAssetId ?? null,
            imageReferenceAssetIds: binding?.imageReferenceAssetIds ?? [],
            videoReferenceAssetIds: binding?.videoReferenceAssetIds ?? [],
          };
        },
        { timeout: 15_000 },
      )
      .toEqual({
        storyboardScriptAssetId: uploadedScriptAssetId,
        imageReferenceAssetIds: [uploadedImageReferenceId],
        videoReferenceAssetIds: [uploadedVideoReferenceId],
      });

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
        await expect(page.getByText(uploadedScriptName).first()).toBeVisible();
        await expect(page.getByText(uploadedScriptBody).first()).toBeVisible();
        const storyboardSubmittedAt = new Date();
        await page.getByRole("button", { name: /\u751f\u6210\u5206\u955c|Generate storyboard/i }).click();
        await expect(page.getByText("Archive room", { exact: true })).toBeVisible({
          timeout: 15_000,
        });

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

    let storyboardTaskId = "";
    await expect
      .poll(
        async () => {
          const storyboardTask = await prisma.task.findFirst({
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
          });

          storyboardTaskId = storyboardTask?.id ?? "";
          return Boolean(storyboardTaskId);
        },
        { timeout: 10_000 },
      )
      .toBe(true);

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
        await expect(page.getByText(imageReferenceName).first()).toBeVisible();

        const imageSubmittedAt = new Date();
        await page.getByLabel(/图片提示词输入框|Image prompt input/i).fill(
          "Generate a cinematic still of the courier.",
        );
        await page.getByRole("button", { name: /\u751f\u6210\u56fe\u7247|Generate image/i }).click();

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
        await expect(page.getByText(happyImageAssetId, { exact: true }).first()).toBeVisible();
      },
    );

    let happyVideoAssetId = "";
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
        await expect(page.getByText(videoReferenceName).first()).toBeVisible();

        await page.getByLabel(/视频提示词输入框|Video prompt input/i).fill(
          "Animate the still with a slow push-in.",
        );
        const happyVideoSubmittedAt = new Date();
        const generateVideoButton = page.getByRole("button", {
          name: /\u751f\u6210\u89c6\u9891|Generate video/i,
        });
        await expect(generateVideoButton).toBeEnabled();
        await generateVideoButton.click();

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
            { timeout: 20_000 },
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
        happyVideoAssetId = happyVideoAsset.id;
        await expect(page.getByText(happyVideoAssetId, { exact: true }).first()).toBeVisible();

        await page.goto(`/projects/${projectId}/assets`);
        await expect(page.getByText(uploadedScriptName).first()).toBeVisible();
        await expect(page.getByText(imageReferenceName).first()).toBeVisible();
        await expect(page.getByText(videoReferenceName).first()).toBeVisible();
        await expect(page.getByText(happyImageAssetId, { exact: true }).first()).toBeVisible();
        await expect(page.getByText(happyVideoAssetId, { exact: true }).first()).toBeVisible();

        await page.goto(`/projects/${projectId}`);
        await expect(page.getByRole("heading", { name: projectTitle })).toBeVisible();
        await expect(page.getByRole("heading", { name: "脚本记录" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "分镜记录" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "图片资产" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "视频资产" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "任务历史" })).toBeVisible();
        await expect(page.getByText(uploadedScriptName).first()).toBeVisible();
        await expect(page.getByText(imageReferenceName).first()).toBeVisible();
        await expect(page.getByText(videoReferenceName).first()).toBeVisible();
        await expect(page.getByText(happyImageAssetId, { exact: true }).first()).toBeVisible();
        await expect(page.getByText(happyVideoAssetId, { exact: true }).first()).toBeVisible();
        await expect(page.getByText(storyboardTaskId, { exact: true }).first()).toBeVisible();

        await page.goto(`/projects/${projectId}/videos`);
        await expect(page.getByText(videoReferenceName).first()).toBeVisible();
        await page.getByLabel(/视频提示词输入框|Video prompt input/i).fill(RETRY_VIDEO_PROMPT);
        const failedVideoSubmittedAt = new Date();
        await page.getByRole("button", { name: /\u751f\u6210\u89c6\u9891|Generate video/i }).click();

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
        await expect(page.getByText(videoReferenceName).first()).toBeVisible();
        await page.getByLabel(/视频提示词输入框|Video prompt input/i).fill(CANCEL_VIDEO_PROMPT);
        const cancelVideoSubmittedAt = new Date();
        await expect(generateVideoButton).toBeEnabled();
        await generateVideoButton.click();

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
        await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toBeVisible();

        const failedTaskCard = page.locator("article").filter({ hasText: failedVideoTaskId }).first();
        const retryResponsePromise = page.waitForResponse((response) => {
          return (
            response.url().includes(`/api/admin/tasks/${failedVideoTaskId}/retry`) &&
            response.request().method() === "POST"
          );
        });
        await failedTaskCard.getByRole("button", { name: /\u91cd\u8bd5|Retry/i }).click();
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
        await runningTaskCard.getByRole("button", { name: /\u53d6\u6d88|Cancel/i }).click();
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
