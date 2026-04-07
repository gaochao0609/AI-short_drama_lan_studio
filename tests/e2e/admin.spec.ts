import path from "node:path";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  TaskStatus,
  TaskType,
  UserRole,
  UserStatus,
} from "@prisma/client";
import { Queue } from "bullmq";
import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/ai_short_drama";
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

function createPrismaClient() {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
}

async function createFileWithAge(filePath: string, contents: string, modifiedAt: Date) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
  const { utimes } = await import("node:fs/promises");
  await utimes(filePath, modifiedAt, modifiedAt);
}

test("admin flow covers approval, task monitoring, retry, cancel, storage stats, and cleanup", async ({
  page,
}) => {
  const prisma = createPrismaClient();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const adminUsername = `admin-task-${suffix}`;
  const requesterUsername = `request-${suffix}`;
  const ownerUsername = `owner-${suffix}`;
  const adminPassword = "AdminPass123!";
  const storageRoot = process.env.STORAGE_ROOT
    ? path.resolve(process.env.STORAGE_ROOT)
    : path.resolve("storage");
  const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  const queue = new Queue("video-queue", {
    connection: {
      url: redisUrl,
      maxRetriesPerRequest: null,
    },
  });

  let ownerId = "";
  let failedTaskId = "";
  let queuedTaskId = "";
  let runningTaskId = "";
  let queuedTaskStepId = "";
  let storageProjectId = "";
  let oldImagePath = "";
  let oldVideoPath = "";
  let keepImagePath = "";
  let persistedImageAssetPath = "";
  let persistedVideoAssetPath = "";

  try {
    const adminPasswordHash = await hash(adminPassword, 12);
    const ownerPasswordHash = await hash("OwnerPass123!", 12);

    await prisma.accountRequest.deleteMany({
      where: {
        username: requesterUsername,
      },
    });
    await prisma.user.deleteMany({
      where: {
        username: {
          in: [adminUsername, requesterUsername, ownerUsername],
        },
      },
    });

    const admin = await prisma.user.create({
      data: {
        username: adminUsername,
        passwordHash: adminPasswordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        forcePasswordChange: false,
      },
    });
    const owner = await prisma.user.create({
      data: {
        username: ownerUsername,
        passwordHash: ownerPasswordHash,
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        forcePasswordChange: false,
      },
    });
    ownerId = owner.id;

    await prisma.accountRequest.create({
      data: {
        username: requesterUsername,
        displayName: `Requester ${suffix}`,
        reason: "Need admin approval",
        status: "PENDING",
      },
    });

    const failedProject = await prisma.project.create({
      data: {
        ownerId: owner.id,
        title: `Failed Project ${suffix}`,
      },
    });
    const queuedProject = await prisma.project.create({
      data: {
        ownerId: owner.id,
        title: `Queued Project ${suffix}`,
      },
    });
    const runningProject = await prisma.project.create({
      data: {
        ownerId: owner.id,
        title: `Running Project ${suffix}`,
      },
    });
    storageProjectId = failedProject.id;

    const failedTask = await prisma.task.create({
      data: {
        projectId: failedProject.id,
        createdById: owner.id,
        type: TaskType.IMAGE,
        status: TaskStatus.FAILED,
        inputJson: {
          projectId: failedProject.id,
          prompt: "Retry failed image",
          userId: owner.id,
        },
        errorText: "provider timeout",
        finishedAt: new Date(),
      },
    });
    failedTaskId = failedTask.id;
    await prisma.taskStep.create({
      data: {
        taskId: failedTask.id,
        stepKey: TaskType.IMAGE,
        status: TaskStatus.FAILED,
        retryCount: 1,
        inputJson: {
          attempt: 1,
        },
        errorText: "provider timeout",
      },
    });

    const queuedTask = await prisma.task.create({
      data: {
        projectId: queuedProject.id,
        createdById: owner.id,
        type: TaskType.VIDEO,
        status: TaskStatus.QUEUED,
        inputJson: {
          projectId: queuedProject.id,
          prompt: "Cancel queued video",
          referenceAssetIds: [],
          userId: owner.id,
        },
      },
    });
    queuedTaskId = queuedTask.id;
    const queuedStep = await prisma.taskStep.create({
      data: {
        taskId: queuedTask.id,
        stepKey: TaskType.VIDEO,
        status: TaskStatus.QUEUED,
        retryCount: 0,
        inputJson: {
          attempt: 0,
        },
      },
    });
    queuedTaskStepId = queuedStep.id;
    await queue.add(
      TaskType.VIDEO,
      {
        taskId: queuedTask.id,
        taskStepId: queuedStep.id,
        traceId: `trace-${suffix}`,
        payload: {
          prompt: "Cancel queued video",
        },
      },
      {
        attempts: 2,
        jobId: queuedStep.id,
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    const runningTask = await prisma.task.create({
      data: {
        projectId: runningProject.id,
        createdById: owner.id,
        type: TaskType.STORYBOARD,
        status: TaskStatus.RUNNING,
        inputJson: {
          projectId: runningProject.id,
          scriptVersionId: `script-${suffix}`,
          userId: owner.id,
        },
        startedAt: new Date(),
      },
    });
    runningTaskId = runningTask.id;
    await prisma.taskStep.create({
      data: {
        taskId: runningTask.id,
        stepKey: TaskType.STORYBOARD,
        status: TaskStatus.RUNNING,
        retryCount: 0,
        inputJson: {
          attempt: 0,
        },
      },
    });

    const uploadsPath = path.join(storageRoot, "uploads", failedProject.id, "task-a", "source.txt");
    oldImagePath = path.join(storageRoot, "generated-images", failedProject.id, "task-b", "cache.png");
    oldVideoPath = path.join(storageRoot, "generated-videos", failedProject.id, "task-c", "preview.mp4");
    const exportsPath = path.join(storageRoot, "exports", failedProject.id, "package.zip");
    keepImagePath = path.join(storageRoot, "generated-images", failedProject.id, "task-d", "keep.png");
    persistedImageAssetPath = path.join(
      storageRoot,
      "assets",
      failedProject.id,
      "references",
      "persisted-reference.png",
    );
    persistedVideoAssetPath = path.join(
      storageRoot,
      "assets",
      failedProject.id,
      "task-e",
      "persisted-output.mp4",
    );

    await createFileWithAge(uploadsPath, "upload-data", new Date());
    await createFileWithAge(oldImagePath, "old-image-cache", oldDate);
    await createFileWithAge(oldVideoPath, "old-video-cache", oldDate);
    await createFileWithAge(exportsPath, "export-data", new Date());
    await createFileWithAge(keepImagePath, "keep-image", oldDate);
    await createFileWithAge(persistedImageAssetPath, "asset-image", new Date());
    await createFileWithAge(persistedVideoAssetPath, "asset-video", new Date());

    await prisma.asset.create({
      data: {
        projectId: failedProject.id,
        kind: "image_generated",
        storagePath: path.relative(storageRoot, keepImagePath),
        originalName: "keep.png",
        mimeType: "image/png",
        sizeBytes: Buffer.byteLength("keep-image"),
      },
    });
    await prisma.asset.create({
      data: {
        projectId: failedProject.id,
        kind: "image_reference",
        storagePath: path.relative(storageRoot, persistedImageAssetPath),
        originalName: "persisted-reference.png",
        mimeType: "image/png",
        sizeBytes: Buffer.byteLength("asset-image"),
      },
    });
    await prisma.asset.create({
      data: {
        projectId: failedProject.id,
        kind: "video_generated",
        storagePath: path.relative(storageRoot, persistedVideoAssetPath),
        originalName: "persisted-output.mp4",
        mimeType: "video/mp4",
        sizeBytes: Buffer.byteLength("asset-video"),
      },
    });

    await page.goto("/login");
    await page.locator('input[autocomplete="username"]').fill(adminUsername);
    await page.locator('input[autocomplete="current-password"]').fill(adminPassword);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/admin\/users$/);

    const requestCard = page.locator("article").filter({ hasText: requesterUsername });
    await expect(requestCard).toHaveCount(1);
    const approvalResponsePromise = page.waitForResponse((response) => {
      return (
        response.url().includes("/api/admin/account-requests") &&
        response.request().method() === "POST"
      );
    });
    await requestCard.getByRole("button", { name: /\u901a\u8fc7\u7533\u8bf7|\u5ba1\u6279|approve/i }).click();
    const approvalResponse = await approvalResponsePromise;
    expect(approvalResponse.ok()).toBe(true);

    await expect(
      prisma.accountRequest.findUniqueOrThrow({
        where: {
          username: requesterUsername,
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        username: requesterUsername,
        status: "APPROVED",
      }),
    );

    await page.goto("/admin/tasks");
    await expect(page.getByRole("heading", { level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3 }).filter({ hasText: /\d+/ })).toBeVisible();
    const failedTaskCard = page.locator("article").filter({ hasText: failedTaskId });
    await expect(failedTaskCard).toHaveCount(1);
    await expect(failedTaskCard).toContainText("provider timeout");
    const retryResponsePromise = page.waitForResponse((response) => {
      return (
        response.url().includes(`/api/admin/tasks/${failedTaskId}/retry`) &&
        response.request().method() === "POST"
      );
    });
    await failedTaskCard.getByRole("button", { name: /\u91cd\u8bd5\u4efb\u52a1|retry/i }).click();
    const retryResponse = await retryResponsePromise;
    expect(retryResponse.status()).toBe(202);
    await expect
      .poll(async () => {
        const task = await prisma.task.findUniqueOrThrow({
          where: { id: failedTaskId },
          include: {
            steps: {
              orderBy: {
                createdAt: "asc",
              },
            },
          },
        });

        return {
          status: task.status,
          stepCount: task.steps.length,
        };
      })
      .toEqual({
        status: TaskStatus.QUEUED,
        stepCount: 2,
      });

    const queuedTaskCard = page.locator("article").filter({ hasText: queuedTaskId });
    await expect(queuedTaskCard).toHaveCount(1);
    const cancelQueuedResponsePromise = page.waitForResponse((response) => {
      return (
        response.url().includes(`/api/admin/tasks/${queuedTaskId}/cancel`) &&
        response.request().method() === "POST"
      );
    });
    await queuedTaskCard.getByRole("button", { name: /\u53d6\u6d88\u4efb\u52a1|cancel/i }).click();
    const cancelQueuedResponse = await cancelQueuedResponsePromise;
    expect(cancelQueuedResponse.status()).toBe(200);
    await expect(
      prisma.task.findUniqueOrThrow({
        where: { id: queuedTaskId },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: queuedTaskId,
        status: TaskStatus.CANCELED,
        cancelRequestedAt: expect.any(Date),
      }),
    );
    await expect(queue.getJob(queuedTaskStepId)).resolves.toBeFalsy();

    const runningTaskCard = page.locator("article").filter({ hasText: runningTaskId });
    await expect(runningTaskCard).toHaveCount(1);
    const cancelRunningResponsePromise = page.waitForResponse((response) => {
      return (
        response.url().includes(`/api/admin/tasks/${runningTaskId}/cancel`) &&
        response.request().method() === "POST"
      );
    });
    await runningTaskCard.getByRole("button", { name: /\u53d6\u6d88\u4efb\u52a1|cancel/i }).click();
    const cancelRunningResponse = await cancelRunningResponsePromise;
    expect(cancelRunningResponse.status()).toBe(202);
    await expect(
      prisma.task.findUniqueOrThrow({
        where: { id: runningTaskId },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: runningTaskId,
        status: TaskStatus.RUNNING,
        cancelRequestedAt: expect.any(Date),
      }),
    );

    await page.goto("/admin/storage");
    await expect(page.getByRole("heading", { level: 2 })).toBeVisible();
    const generatedImagesCard = page.locator("article").filter({ hasText: "generated-images" });
    const generatedVideosCard = page.locator("article").filter({ hasText: "generated-videos" });
    await expect(generatedImagesCard).toContainText(/\d+(?:\.\d+)?\s(?:B|KB|MB|GB|TB)/);
    await expect(generatedVideosCard).toContainText(/\d+(?:\.\d+)?\s(?:B|KB|MB|GB|TB)/);
    const cleanupResponsePromise = page.waitForResponse((response) => {
      return (
        response.url().includes("/api/admin/storage/cleanup") &&
        response.request().method() === "POST"
      );
    });
    await page.getByRole("button", { name: /30/ }).click();
    const cleanupResponse = await cleanupResponsePromise;
    expect(cleanupResponse.status()).toBe(200);
    await expect(page.getByRole("status")).toContainText(/2/);
    await expect(stat(oldImagePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(oldVideoPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(keepImagePath)).resolves.toEqual(
      expect.objectContaining({
        size: Buffer.byteLength("keep-image"),
      }),
    );
  } finally {
    await page.context().clearCookies().catch(() => undefined);
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    if (storageProjectId) {
      await rm(path.join(storageRoot, "uploads", storageProjectId), {
        recursive: true,
        force: true,
      });
      await rm(path.join(storageRoot, "generated-images", storageProjectId), {
        recursive: true,
        force: true,
      });
      await rm(path.join(storageRoot, "generated-videos", storageProjectId), {
        recursive: true,
        force: true,
      });
      await rm(path.join(storageRoot, "exports", storageProjectId), {
        recursive: true,
        force: true,
      });
      await rm(path.join(storageRoot, "assets", storageProjectId), {
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
          in: [adminUsername, requesterUsername, ownerUsername],
        },
      },
    });
    await prisma.$disconnect();
  }
});
