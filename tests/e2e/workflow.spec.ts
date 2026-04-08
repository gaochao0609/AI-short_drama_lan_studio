import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  AssetCategory,
  AssetOrigin,
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
const appUrl = process.env.APP_URL ?? "http://127.0.0.1:3000";
const workspaceHeroTitle = "\u4eca\u65e5\u521b\u4f5c\u63a7\u5236\u53f0";
const createProjectCta = "\u521b\u5efa\u9879\u76ee\u5e76\u8fdb\u5165\u811a\u672c\u6d41\u7a0b";
const projectTitleLabel = /\u9879\u76ee\u540d\u79f0|project title/i;
const projectIdeaLabel = /\u9879\u76ee\u6982\u5ff5|project idea/i;

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

function readMultipartFieldValues(contentType: string, body: Buffer) {
  const boundaryMatch = /boundary=([^;]+)/i.exec(contentType);
  expect(boundaryMatch).not.toBeNull();

  const boundary = boundaryMatch?.[1]?.trim();
  expect(boundary).toBeTruthy();

  const valuesByField = new Map<string, string[]>();
  const rawBody = body.toString("utf8");
  const parts = rawBody.split(`--${boundary}`);

  for (const part of parts) {
    const trimmedPart = part.trim();
    if (!trimmedPart || trimmedPart === "--") {
      continue;
    }

    const nameMatch = /name="([^"]+)"/i.exec(part);
    if (!nameMatch) {
      continue;
    }

    const valueStart = part.indexOf("\r\n\r\n");
    if (valueStart === -1) {
      continue;
    }

    const value = part.slice(valueStart + 4).replace(/\r\n$/, "");
    const existingValues = valuesByField.get(nameMatch[1]) ?? [];
    existingValues.push(value);
    valuesByField.set(nameMatch[1], existingValues);
  }

  return valuesByField;
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

async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

async function expectVisibleFocusIndicator(page: Page) {
  const navLink = page.locator('nav a[href="/workspace"]').first();
  await expect(navLink).toBeVisible();
  const baselineStyle = await navLink.evaluate((element) => {
    const link = element as HTMLElement;
    const style = getComputedStyle(link);
    return {
      borderTopColor: style.borderTopColor,
      backgroundColor: style.backgroundColor,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow,
      transform: style.transform,
    };
  });

  let focusState: {
    isFocused: boolean;
    isFocusVisible: boolean;
    borderTopColor: string;
    backgroundColor: string;
    outlineStyle: string;
    outlineWidth: string;
    boxShadow: string;
    transform: string;
  } | null = null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.keyboard.press("Tab");
    focusState = await navLink.evaluate((element) => {
      const link = element as HTMLElement;
      const style = getComputedStyle(link);

      return {
        isFocused: document.activeElement === link,
        isFocusVisible: link.matches(":focus-visible"),
        borderTopColor: style.borderTopColor,
        backgroundColor: style.backgroundColor,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        boxShadow: style.boxShadow,
        transform: style.transform,
      };
    });

    if (focusState.isFocused) {
      break;
    }
  }

  expect(focusState).not.toBeNull();
  expect(focusState!.isFocused).toBe(true);
  expect(focusState!.isFocusVisible).toBe(true);
  const hasOutline = focusState!.outlineStyle !== "none" && focusState!.outlineWidth !== "0px";
  const hasShadow = focusState!.boxShadow !== "none";
  const hasStyleDelta =
    focusState!.borderTopColor !== baselineStyle.borderTopColor ||
    focusState!.backgroundColor !== baselineStyle.backgroundColor ||
    focusState!.outlineStyle !== baselineStyle.outlineStyle ||
    focusState!.outlineWidth !== baselineStyle.outlineWidth ||
    focusState!.boxShadow !== baselineStyle.boxShadow ||
    focusState!.transform !== baselineStyle.transform;
  expect(hasStyleDelta || hasOutline || hasShadow).toBe(true);
}

test("workspace create-project form navigates into the project flow", async ({ page }) => {
  const prisma = createPrismaClient();
  const suffix = Math.random().toString(36).slice(2, 10);
  const username = `workspace-create-${suffix}`;
  const password = "WorkflowE2E123!";
  const passwordHash = await hash(password, 12);
  let userId = "";

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

    await page.goto(`${appUrl}/login`);
    await page.locator('input[autocomplete="username"]').fill(username);
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/workspace$/);
    await expect(page.getByRole("heading", { name: workspaceHeroTitle })).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    await expectNoHorizontalOverflow(page);
    await expectVisibleFocusIndicator(page);

    await page.getByRole("textbox", { name: projectTitleLabel }).fill("Workspace Flow Project");
    await page.getByRole("textbox", { name: projectIdeaLabel }).fill(
      "Navigate from the workspace form into the project flow.",
    );
    await page.getByRole("button", { name: createProjectCta }).click();

    await expect(page).toHaveURL(/\/projects\/[^/]+$/);
    const projectId = page.url().split("/").at(-1) ?? "";
    await expectNoHorizontalOverflow(page);
    const projectWorkflowRegion = page
      .getByRole("region", { name: /\u6d41\u7a0b\u63a7\u5236|workflow control/i })
      .filter({ has: page.locator(`a[href="/projects/${projectId}/script"]`) })
      .filter({ has: page.getByRole("link", { name: /\u8fdb\u5165\u811a\u672c\u6d41\u7a0b|script/i }) });
    await expect(projectWorkflowRegion).toHaveCount(1);
    await expect(projectWorkflowRegion.getByRole("link", { name: /\u8fdb\u5165\u811a\u672c\u6d41\u7a0b|script/i }))
      .toHaveAttribute("href", `/projects/${projectId}/script`);
    await expect(projectWorkflowRegion.getByText("Script", { exact: true })).toBeVisible();
    await expect(projectWorkflowRegion.getByText("Storyboard", { exact: true })).toBeVisible();
    const firstWorkflowItem = projectWorkflowRegion.getByRole("listitem").first();
    await expect(firstWorkflowItem).toContainText("Script");
    await expect(firstWorkflowItem).toContainText(/\u4e0b\u4e00\u6b65|next/i);
  } finally {
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

test("workflow routes asset-center uploads and generated artifacts into project detail", async ({ page }) => {
  const prisma = createPrismaClient();
  const suffix = Math.random().toString(36).slice(2, 10);
  const username = `workflow-e2e-${suffix}`;
  const password = "WorkflowE2E123!";
  const passwordHash = await hash(password, 12);
  const storageRoot = process.env.STORAGE_ROOT
    ? path.resolve(process.env.STORAGE_ROOT)
    : path.resolve("storage");
  const uploadedScriptName = `workflow-script-${suffix}.md`;
  const uploadedReferenceAName = `reference-a-${suffix}.png`;
  const uploadedReferenceBName = `reference-b-${suffix}.png`;
  const uploadedScriptBody = "INT. CONTROL ROOM - NIGHT\nA courier opens the sealed memory vault.";
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

    await page.goto(`${appUrl}/login`);
    await page.locator('input[autocomplete="username"]').fill(username);
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/workspace$/);
    await expect(page.getByRole("heading", { name: workspaceHeroTitle })).toBeVisible();
    await expect(page.getByRole("button", { name: createProjectCta })).toBeVisible();
    const workflowOverview = page.getByLabel("Workflow Overview");
    await expect(workflowOverview.getByText("Script", { exact: true })).toBeVisible();
    await expect(workflowOverview.getByText("Storyboard", { exact: true })).toBeVisible();

    await page.getByRole("textbox", { name: projectTitleLabel }).fill("Workflow Detail Project");
    await page.getByRole("textbox", { name: projectIdeaLabel }).fill(
      "Create every artifact and show it on the detail page.",
    );
    await page.getByRole("button", { name: createProjectCta }).click();
    await expect(page).toHaveURL(/\/projects\/[^/]+$/);
    projectId = page.url().split("/").at(-1) ?? "";

    await page.route("**/api/storyboards", async (route) => {
      if (route.request().method() === "GET") {
        await route.fallback();
        return;
      }

      const taskId = `task-storyboard-${suffix}`;
      const storyboardVersionId = `storyboard-version-${suffix}`;
      const scriptVersionId = `script-version-${suffix}`;
      const binding = await prisma.projectWorkflowBinding.findUnique({
        where: {
          projectId,
        },
        select: {
          storyboardScriptAssetId: true,
        },
      });
      const storyboardScriptAssetId = binding?.storyboardScriptAssetId ?? "";

      await insertTaskRow(prisma, {
        id: taskId,
        projectId,
        createdById: user.id,
        type: TaskType.STORYBOARD,
        status: TaskStatus.SUCCEEDED,
        inputJson: {
          projectId,
          scriptAssetId: storyboardScriptAssetId,
        },
        outputJson: {
          storyboardVersionId,
          storyboardScriptAssetId,
          scriptVersionId,
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
      await prisma.scriptVersion.create({
        data: {
          id: scriptVersionId,
          projectId,
          creatorId: user.id,
          versionNumber: 1,
          body: uploadedScriptBody,
          scriptJson: {
            body: uploadedScriptBody,
          },
        },
      });
      await prisma.storyboardVersion.create({
        data: {
          id: storyboardVersionId,
          projectId,
          scriptVersionId,
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

      const contentType = route.request().headers()["content-type"] ?? "";
      const requestBody = route.request().postDataBuffer();
      expect(requestBody).not.toBeNull();

      const formValues = readMultipartFieldValues(contentType, requestBody!);
      const submittedProjectIds = formValues.get("projectId") ?? [];
      const submittedPrompts = formValues.get("prompt") ?? [];
      const submittedReferenceAssetIds = formValues.get("referenceAssetIds") ?? [];

      expect(submittedProjectIds).toEqual([projectId]);
      expect(submittedPrompts).toEqual(["Generate a cinematic still of the courier."]);
      expect(submittedReferenceAssetIds).toEqual([uploadedReferenceAId, uploadedReferenceBId]);

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
          prompt: "Generate a cinematic still of the courier.",
          referenceAssetIds: submittedReferenceAssetIds,
          sourceAssetId: submittedReferenceAssetIds[0] ?? null,
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
          category: AssetCategory.IMAGE_GENERATED,
          origin: AssetOrigin.SYSTEM,
          storagePath: relativePath,
          originalName: `image-${suffix}.png`,
          mimeType: "image/png",
          sizeBytes: ONE_BY_ONE_PNG_BYTES.length,
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
          prompt: "Animate the storyboard reference with a slow push-in.",
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
          category: AssetCategory.VIDEO_GENERATED,
          origin: AssetOrigin.SYSTEM,
          storagePath: relativePath,
          originalName: `video-${suffix}.mp4`,
          mimeType: "video/mp4",
          sizeBytes: SAMPLE_MP4_BYTES.length,
        },
      });

      await route.fulfill({
        status: 202,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ taskId }),
      });
    });

    await page.goto(`${appUrl}/projects/${projectId}/assets`);
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/assets$`));
    await expect(page.locator('input[type="file"]')).toHaveCount(1);

    await uploadAssetThroughPicker(page, {
      name: uploadedScriptName,
      mimeType: "text/markdown",
      buffer: Buffer.from(uploadedScriptBody, "utf8"),
    });

    let uploadedScriptAssetId = "";
    await expect
      .poll(async () => {
        const asset = await findProjectAssetByName(prisma, {
          projectId,
          originalName: uploadedScriptName,
        });
        uploadedScriptAssetId = asset?.id ?? "";
        return Boolean(uploadedScriptAssetId);
      })
      .toBe(true);

    await prisma.asset.update({
      where: {
        id: uploadedScriptAssetId,
      },
      data: {
        metadata: {
          extension: ".md",
          originalFileName: uploadedScriptName,
          parseStatus: "ready",
          extractedText: uploadedScriptBody,
        },
      },
    });

    await expect
      .poll(async () => {
        const asset = await prisma.asset.findUnique({
          where: {
            id: uploadedScriptAssetId,
          },
          select: {
            metadata: true,
          },
        });
        return readMetadataObject(asset?.metadata).parseStatus ?? null;
      })
      .toBe("ready");

    await page.reload();
    await expect(page.getByText(uploadedScriptName).first()).toBeVisible();
    const uploadedScriptCard = await openBindingMenu(page, uploadedScriptAssetId);
    await uploadedScriptCard.locator(`button[aria-label^="${uploadedScriptAssetId} "]`).first().click();

    await expect
      .poll(async () => {
        const binding = await prisma.projectWorkflowBinding.findUnique({
          where: {
            projectId,
          },
          select: {
            storyboardScriptAssetId: true,
          },
        });
        return binding?.storyboardScriptAssetId ?? null;
      })
      .toBe(uploadedScriptAssetId);

    await uploadAssetThroughPicker(page, {
      name: uploadedReferenceAName,
      mimeType: "image/png",
      buffer: ONE_BY_ONE_PNG_BYTES,
    });

    let uploadedReferenceAId = "";
    await expect
      .poll(async () => {
        const asset = await findProjectAssetByName(prisma, {
          projectId,
          originalName: uploadedReferenceAName,
        });
        uploadedReferenceAId = asset?.id ?? "";
        return Boolean(uploadedReferenceAId);
      })
      .toBe(true);

    await uploadAssetThroughPicker(page, {
      name: uploadedReferenceBName,
      mimeType: "image/png",
      buffer: ONE_BY_ONE_PNG_BYTES,
    });

    let uploadedReferenceBId = "";
    await expect
      .poll(async () => {
        const asset = await findProjectAssetByName(prisma, {
          projectId,
          originalName: uploadedReferenceBName,
        });
        uploadedReferenceBId = asset?.id ?? "";
        return Boolean(uploadedReferenceBId);
      })
      .toBe(true);

    const referenceACard = await openBindingMenu(page, uploadedReferenceAId);
    await referenceACard.locator(`button[aria-label^="${uploadedReferenceAId} "]`).nth(0).click();
    const referenceACardForVideo = await openBindingMenu(page, uploadedReferenceAId);
    await referenceACardForVideo.locator(`button[aria-label^="${uploadedReferenceAId} "]`).nth(1).click();
    const referenceBCard = await openBindingMenu(page, uploadedReferenceBId);
    await referenceBCard.locator(`button[aria-label^="${uploadedReferenceBId} "]`).nth(0).click();

    await expect
      .poll(async () => {
        const binding = await prisma.projectWorkflowBinding.findUnique({
          where: {
            projectId,
          },
          select: {
            imageReferenceAssetIds: true,
            videoReferenceAssetIds: true,
          },
        });
        return {
          imageReferenceAssetIds: binding?.imageReferenceAssetIds ?? [],
          videoReferenceAssetIds: binding?.videoReferenceAssetIds ?? [],
        };
      })
      .toEqual({
        imageReferenceAssetIds: [uploadedReferenceAId, uploadedReferenceBId],
        videoReferenceAssetIds: [uploadedReferenceAId],
      });

    await page.goto(`${appUrl}/projects/${projectId}/storyboard`);
    await expect(page.getByText(uploadedScriptName).first()).toBeVisible();
    await expect(page.getByText(uploadedScriptBody).first()).toBeVisible();
    await page.getByRole("button", { name: /\u751f\u6210\u5206\u955c|Generate storyboard/i }).click();
    await expect(page.getByText("Control room", { exact: true })).toBeVisible();
    await expect(page.getByText("Vault interior", { exact: true })).toBeVisible();

    await page.goto(`${appUrl}/projects/${projectId}/images`);
    await expect(page.getByText(uploadedReferenceAName).first()).toBeVisible();
    await expect(page.getByText(uploadedReferenceBName).first()).toBeVisible();
    await page
      .getByLabel(/\u56fe\u7247\u63d0\u793a\u8bcd\u8f93\u5165\u6846|Image prompt input/i)
      .fill("Generate a cinematic still of the courier.");
    await page.getByRole("button", { name: /\u751f\u6210\u56fe\u7247|Generate image/i }).click();
    await expect(page.getByText(`image-${suffix}.png`).first()).toBeVisible();

    await page.goto(`${appUrl}/projects/${projectId}/videos`);
    await expect(page.getByText(uploadedReferenceAName).first()).toBeVisible();
    await page
      .getByLabel(/\u89c6\u9891\u63d0\u793a\u8bcd\u8f93\u5165\u6846|Video prompt input/i)
      .fill("Animate the storyboard reference with a slow push-in.");
    await page.getByRole("button", { name: /\u751f\u6210\u89c6\u9891|Generate video/i }).click();
    await expect(page.getByText(`asset-video-${suffix}`, { exact: true }).first()).toBeVisible();

    await page.goto(`${appUrl}/projects/${projectId}/assets`);
    await expect(page.getByText(uploadedScriptName).first()).toBeVisible();
    await expect(page.getByText(uploadedReferenceAName).first()).toBeVisible();
    await expect(page.getByText(uploadedReferenceBName).first()).toBeVisible();
    await expect(page.getByText(`image-${suffix}.png`).first()).toBeVisible();
    await expect(page.getByText(`video-${suffix}.mp4`).first()).toBeVisible();

    await page.goto(`${appUrl}/projects/${projectId}`);
    await expect(page.getByRole("heading", { name: "Workflow Detail Project" })).toBeVisible();
    await expect(page.locator(`a[href="/projects/${projectId}/script"]`).first()).toBeVisible();
    await expect(page.locator(`a[href="/projects/${projectId}/assets"]`).first()).toBeVisible();
    await expect(page.getByText("Script", { exact: true })).toBeVisible();
    await expect(page.getByText("Images", { exact: true })).toBeVisible();
    await expect(page.getByText(uploadedScriptName, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(uploadedReferenceAName, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(uploadedReferenceBName, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(`image-${suffix}.png`, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(`video-${suffix}.mp4`, { exact: true }).first()).toBeVisible();
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
