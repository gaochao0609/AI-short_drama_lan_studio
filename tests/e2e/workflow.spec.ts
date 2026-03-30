import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
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

const ONE_BY_ONE_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7GZxkAAAAASUVORK5CYII=",
  "base64",
);

const SAMPLE_MP4_BYTES = Buffer.from("000000186674797069736F6D0000020069736F6D69736F32", "hex");

function createPrismaClient() {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
}

async function ensureAssetFile(storageRoot: string, relativePath: string, bytes: Uint8Array) {
  const absolutePath = path.join(storageRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
}

async function insertTaskRow(
  prisma: PrismaClient,
  input: {
    id: string;
    projectId: string;
    createdById: string;
    type: TaskType;
    status: TaskStatus;
    inputJson: Record<string, unknown>;
    outputJson: Record<string, unknown>;
  },
) {
  const timestamp = new Date();

  await prisma.$executeRawUnsafe(
    `INSERT INTO tasks (
      id,
      project_id,
      created_by_id,
      type,
      status,
      input_json,
      output_json,
      error_text,
      started_at,
      finished_at,
      created_at,
      updated_at
    ) VALUES (
      $1,
      $2,
      $3,
      $4::"TaskType",
      $5::"TaskStatus",
      $6::jsonb,
      $7::jsonb,
      NULL,
      NULL,
      $8,
      $8,
      $8
    )`,
    input.id,
    input.projectId,
    input.createdById,
    input.type,
    input.status,
    JSON.stringify(input.inputJson),
    JSON.stringify(input.outputJson),
    timestamp,
  );
}

test("workflow shows all generated artifacts in project detail", async ({ page }) => {
  const prisma = createPrismaClient();
  const suffix = Math.random().toString(36).slice(2, 10);
  const username = `workflow-e2e-${suffix}`;
  const password = "WorkflowE2E123!";
  const passwordHash = await hash(password, 12);
  const storageRoot = process.env.STORAGE_ROOT
    ? path.resolve(process.env.STORAGE_ROOT)
    : path.resolve("storage");
  const taskResponses = new Map<
    string,
    {
      id: string;
      status: TaskStatus;
      outputJson?: Record<string, unknown> | null;
    }
  >();
  let userId = "";
  let projectId = "";

  try {
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        forcePasswordChange: false,
      },
    });
    userId = user.id;

    await page.goto("http://127.0.0.1:3000/login");
    await page.locator('input[autocomplete="username"]').fill(username);
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/workspace$/);

    const createProjectPayload = await page.evaluate(async () => {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: "Workflow Detail Project",
          idea: "Create every artifact and show it on the detail page.",
        }),
      });

      return response.json();
    });
    projectId = String((createProjectPayload as { id: string }).id);

    await page.route("**/api/script/sessions", async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "text/event-stream; charset=utf-8",
        body: [
          "event: session\n",
          'data: {"sessionId":"workflow-session"}\n\n',
          "event: question\n",
          'data: {"delta":"Who is the protagonist?"}\n\n',
          "event: done\n",
          'data: {"questionText":"Who is the protagonist?"}\n\n',
        ].join(""),
      });
    });

    await page.route("**/api/script/sessions/workflow-session/message", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        body: [
          "event: question\n",
          'data: {"delta":"What is at stake?"}\n\n',
          "event: done\n",
          'data: {"questionText":"What is at stake?"}\n\n',
        ].join(""),
      });
    });

    await page.route("**/api/script/sessions/workflow-session/finalize", async (route) => {
      const taskId = `task-script-${suffix}`;
      const scriptVersionId = `script-version-${suffix}`;

      await insertTaskRow(prisma, {
        id: taskId,
        projectId,
        createdById: user.id,
        type: TaskType.SCRIPT_FINALIZE,
        status: TaskStatus.SUCCEEDED,
        inputJson: {
          projectId,
          sessionId: "workflow-session",
        },
        outputJson: {
          scriptVersionId,
          body: "INT. CONTROL ROOM - NIGHT\nA courier opens the sealed memory vault.",
        },
      });
      await prisma.scriptVersion.create({
        data: {
          id: scriptVersionId,
          projectId,
          creatorId: user.id,
          versionNumber: 1,
          body: "INT. CONTROL ROOM - NIGHT\nA courier opens the sealed memory vault.",
          scriptJson: {
            body: "INT. CONTROL ROOM - NIGHT\nA courier opens the sealed memory vault.",
          },
        },
      });
      taskResponses.set(taskId, {
        id: taskId,
        status: TaskStatus.SUCCEEDED,
        outputJson: {
          scriptVersionId,
          body: "INT. CONTROL ROOM - NIGHT\nA courier opens the sealed memory vault.",
        },
      });

      await route.fulfill({
        status: 202,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ taskId }),
      });
    });

    await page.route("**/api/storyboards", async (route) => {
      if (route.request().method() === "GET") {
        await route.fallback();
        return;
      }

      const taskId = `task-storyboard-${suffix}`;
      const storyboardVersionId = `storyboard-version-${suffix}`;

      await insertTaskRow(prisma, {
        id: taskId,
        projectId,
        createdById: user.id,
        type: TaskType.STORYBOARD,
        status: TaskStatus.SUCCEEDED,
        inputJson: {
          projectId,
        },
        outputJson: {
          storyboardVersionId,
          segments: [
            { index: 1, durationSeconds: 15 },
            { index: 2, durationSeconds: 15 },
          ],
        },
      });
      await prisma.storyboardVersion.create({
        data: {
          id: storyboardVersionId,
          projectId,
          scriptVersionId: `script-version-${suffix}`,
          taskId,
          framesJson: [
            {
              index: 1,
              durationSeconds: 15,
              scene: "Control room",
              shot: "Wide",
              action: "The courier scans the vault.",
              dialogue: "",
              videoPrompt: "Slow push in on the courier.",
            },
            {
              index: 2,
              durationSeconds: 15,
              scene: "Vault interior",
              shot: "Close",
              action: "Hidden memory reels glow.",
              dialogue: "",
              videoPrompt: "Track across the glowing reels.",
            },
          ],
        },
      });
      taskResponses.set(taskId, {
        id: taskId,
        status: TaskStatus.SUCCEEDED,
        outputJson: {
          storyboardVersionId,
          segments: [
            {
              index: 1,
              durationSeconds: 15,
              scene: "Control room",
              shot: "Wide",
              action: "The courier scans the vault.",
              dialogue: "",
              videoPrompt: "Slow push in on the courier.",
            },
            {
              index: 2,
              durationSeconds: 15,
              scene: "Vault interior",
              shot: "Close",
              action: "Hidden memory reels glow.",
              dialogue: "",
              videoPrompt: "Track across the glowing reels.",
            },
          ],
        },
      });

      await route.fulfill({
        status: 202,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ taskId }),
      });
    });

    await page.route("**/api/images", async (route) => {
      if (route.request().method() === "GET") {
        await route.fallback();
        return;
      }

      const taskId = `task-image-${suffix}`;
      const assetId = `asset-image-${suffix}`;
      const relativePath = path.join("assets", projectId, "generated", `image-${suffix}.png`);
      await ensureAssetFile(storageRoot, relativePath, ONE_BY_ONE_PNG_BYTES);

      await insertTaskRow(prisma, {
        id: taskId,
        projectId,
        createdById: user.id,
        type: TaskType.IMAGE,
        status: TaskStatus.SUCCEEDED,
        inputJson: {
          projectId,
          prompt: "Generate a keyframe",
        },
        outputJson: {
          outputAssetId: assetId,
        },
      });
      await prisma.asset.create({
        data: {
          id: assetId,
          projectId,
          taskId,
          kind: "image_generated",
          storagePath: relativePath,
          originalName: `image-${suffix}.png`,
          mimeType: "image/png",
          sizeBytes: ONE_BY_ONE_PNG_BYTES.length,
        },
      });
      taskResponses.set(taskId, {
        id: taskId,
        status: TaskStatus.SUCCEEDED,
        outputJson: {
          outputAssetId: assetId,
        },
      });

      await route.fulfill({
        status: 202,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ taskId }),
      });
    });

    await page.route("**/api/videos", async (route) => {
      if (route.request().method() === "GET") {
        await route.fallback();
        return;
      }

      const taskId = `task-video-${suffix}`;
      const assetId = `asset-video-${suffix}`;
      const relativePath = path.join("assets", projectId, "generated", `video-${suffix}.mp4`);
      await ensureAssetFile(storageRoot, relativePath, SAMPLE_MP4_BYTES);

      await insertTaskRow(prisma, {
        id: taskId,
        projectId,
        createdById: user.id,
        type: TaskType.VIDEO,
        status: TaskStatus.SUCCEEDED,
        inputJson: {
          projectId,
          prompt: "Animate the keyframe",
        },
        outputJson: {
          outputAssetId: assetId,
        },
      });
      await prisma.asset.create({
        data: {
          id: assetId,
          projectId,
          taskId,
          kind: "video_generated",
          storagePath: relativePath,
          originalName: `video-${suffix}.mp4`,
          mimeType: "video/mp4",
          sizeBytes: SAMPLE_MP4_BYTES.length,
        },
      });
      taskResponses.set(taskId, {
        id: taskId,
        status: TaskStatus.SUCCEEDED,
        outputJson: {
          outputAssetId: assetId,
        },
      });

      await route.fulfill({
        status: 202,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ taskId }),
      });
    });

    await page.route("**/api/tasks/*", async (route) => {
      const taskId = new URL(route.request().url()).pathname.split("/").pop() ?? "";
      const payload = taskResponses.get(taskId);

      if (!payload) {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify(payload),
      });
    });

    await page.goto(`http://127.0.0.1:3000/projects/${projectId}/script`);
    await page.getByLabel("Script idea input").fill(
      "A courier opens the vault that can rewrite every memory in the city.",
    );
    await page.getByRole("button", { name: "Start script session" }).click();
    await expect(page.getByText("Who is the protagonist?")).toBeVisible();
    await page.getByLabel("Script answer input").fill("A courier who smuggles forbidden memories.");
    await page.getByRole("button", { name: "Send script answer" }).click();
    await expect(page.getByText("What is at stake?")).toBeVisible();
    await page.getByRole("button", { name: "Finalize script" }).click();
    await expect(page.getByText("INT. CONTROL ROOM - NIGHT")).toBeVisible();

    await page.goto(`http://127.0.0.1:3000/projects/${projectId}/storyboard`);
    await page.getByRole("button", { name: "Generate storyboard" }).click();
    await expect(page.getByText("Storyboard generated.")).toBeVisible();
    await expect(page.getByText("2 segments")).toBeVisible();

    await page.goto(`http://127.0.0.1:3000/projects/${projectId}/images`);
    await page.getByLabel("Image prompt input").fill("Generate a cinematic still of the courier.");
    await page.getByRole("button", { name: "Generate image" }).click();
    await expect(page.getByText("Image generated.")).toBeVisible();

    await page.goto(`http://127.0.0.1:3000/projects/${projectId}/videos`);
    await page.getByLabel("Video prompt input").fill("Animate the still with a slow push-in.");
    await page.getByRole("button", { name: new RegExp(`asset-image-${suffix}`) }).click();
    await page.getByRole("button", { name: "Generate video" }).click();
    await expect(page.getByText("Video generated.")).toBeVisible();

    await page.goto(`http://127.0.0.1:3000/projects/${projectId}`);
    await expect(page.getByRole("heading", { name: "Script Versions" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Storyboard Versions" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Image Assets" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Video Assets" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Task History" })).toBeVisible();
    await expect(page.getByText(`asset-image-${suffix}`)).toBeVisible();
    await expect(page.getByText(`asset-video-${suffix}`)).toBeVisible();
    await expect(page.getByText(`task-video-${suffix}`)).toBeVisible();
  } finally {
    if (projectId) {
      await rm(path.join(storageRoot, "assets", projectId), { recursive: true, force: true });
    }
    if (userId) {
      await prisma.user.deleteMany({
        where: {
          id: userId,
        },
      });
    }
    await prisma.$disconnect();
  }
});
