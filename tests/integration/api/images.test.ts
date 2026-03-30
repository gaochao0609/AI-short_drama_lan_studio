import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { UserRole, UserStatus, type PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { insertSessionForUser, loadRouteModule, withApiTestEnv } from "./test-api";
import { withTestDatabase } from "../db/test-database";

async function createActiveUser(prisma: PrismaClient, username: string) {
  return prisma.user.create({
    data: {
      username,
      passwordHash: "hash-for-images-api-user",
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      forcePasswordChange: false,
    },
  });
}

afterEach(() => {
  vi.doUnmock("next/headers");
  vi.resetModules();
});

describe("images workspace api", () => {
  it("returns project image assets with previews for owned projects", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-images-api-"));

      try {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const user = await createActiveUser(prisma, "images-workspace-owner");
            const otherUser = await createActiveUser(prisma, "images-workspace-other");
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Images Workspace",
              },
            });
            const otherProject = await prisma.project.create({
              data: {
                ownerId: otherUser.id,
                title: "Other Project",
              },
            });

            const bytes = Buffer.from("fake-png-bytes");
            const relativePath = path.join("assets", project.id, "seed.png");
            await mkdir(path.join(storageRoot, "assets", project.id), { recursive: true });
            await writeFile(path.join(storageRoot, relativePath), bytes);

            await prisma.asset.create({
              data: {
                projectId: project.id,
                kind: "image_generated",
                storagePath: relativePath,
                originalName: "seed.png",
                mimeType: "image/png",
                sizeBytes: bytes.length,
              },
            });
            await prisma.asset.create({
              data: {
                projectId: otherProject.id,
                kind: "image_generated",
                storagePath: "assets/other.png",
                originalName: "other.png",
                mimeType: "image/png",
                sizeBytes: 12,
              },
            });

            const session = await insertSessionForUser(prisma, user.id);
            vi.resetModules();
            const route = await loadRouteModule<{
              GET: (request: Request) => Promise<Response>;
            }>("src/app/api/images/route.ts", {
              sessionToken: session.token,
            });

            const response = await route.GET(
              new Request(`http://localhost/api/images?projectId=${project.id}`, {
                method: "GET",
              }),
            );

            expect(response.status).toBe(200);
            const payload = await response.json();
            expect(payload).toEqual(
              expect.objectContaining({
                project: expect.objectContaining({
                  id: project.id,
                  title: "Images Workspace",
                }),
                maxUploadMb: 25,
                assets: [
                  expect.objectContaining({
                    mimeType: "image/png",
                    previewDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
                  }),
                ],
              }),
            );

            // Service read path should exist and enforce ownership.
            const { getImagesWorkspaceData } = await import("@/lib/services/images");
            const servicePayload = await getImagesWorkspaceData(project.id, user.id);

            expect(servicePayload.project.id).toBe(project.id);
            expect(servicePayload.assets).toHaveLength(1);
            expect(servicePayload.assets[0]).toEqual(
              expect.objectContaining({
                mimeType: "image/png",
                previewDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
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
    });
  });

  it("rejects image workspace reads for projects not owned by the user", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-images-api-forbidden-"));

      try {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const owner = await createActiveUser(prisma, "images-forbidden-owner");
            const otherUser = await createActiveUser(prisma, "images-forbidden-other");
            const project = await prisma.project.create({
              data: {
                ownerId: owner.id,
                title: "Forbidden Images",
              },
            });

            const session = await insertSessionForUser(prisma, otherUser.id);
            const route = await loadRouteModule<{
              GET: (request: Request) => Promise<Response>;
            }>("src/app/api/images/route.ts", {
              sessionToken: session.token,
            });

            const response = await route.GET(
              new Request(`http://localhost/api/images?projectId=${project.id}`, {
                method: "GET",
              }),
            );

            expect(response.status).toBe(404);
          },
          {
            STORAGE_ROOT: storageRoot,
          },
        );
      } finally {
        await rm(storageRoot, { recursive: true, force: true });
      }
    });
  });

  it("persists uploaded reference images as assets and associates them to the image task", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-images-api-upload-"));

      try {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const user = await createActiveUser(prisma, "images-upload-owner");
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Images Upload Project",
              },
            });
            const session = await insertSessionForUser(prisma, user.id);
            vi.resetModules();
            const route = await loadRouteModule<{
              POST: (request: Request) => Promise<Response>;
            }>("src/app/api/images/route.ts", {
              sessionToken: session.token,
            });

            const referenceBytes = Buffer.from("reference-png-bytes");
            const referenceFile = new File([referenceBytes], "reference.png", {
              type: "image/png",
            });
            const form = new FormData();
            form.set("projectId", project.id);
            form.set("prompt", "Transform this image into a watercolor poster.");
            form.set("sourceFile", referenceFile);

            const response = await route.POST(
              {
                url: "http://localhost/api/images",
                headers: new Headers({
                  "content-type": "multipart/form-data; boundary=----vitest",
                  "content-length": String(referenceBytes.length),
                }),
                formData: async () => form,
              } as unknown as Request,
            );

            expect(response.status).toBe(202);
            const payload = (await response.json()) as { taskId?: string };
            expect(payload.taskId).toEqual(expect.any(String));

            const task = await prisma.task.findUniqueOrThrow({
              where: {
                id: payload.taskId!,
              },
            });

            expect(task.inputJson).toEqual(
              expect.objectContaining({
                projectId: project.id,
                prompt: expect.any(String),
                mode: "image_edit",
                sourceAssetId: expect.any(String),
              }),
            );

            const sourceAssetId = (task.inputJson as { sourceAssetId?: string }).sourceAssetId!;
            const asset = await prisma.asset.findUniqueOrThrow({
              where: {
                id: sourceAssetId,
              },
            });

            expect(asset).toEqual(
              expect.objectContaining({
                projectId: project.id,
                taskId: payload.taskId!,
                kind: "image_reference",
                originalName: "reference.png",
                mimeType: "image/png",
                sizeBytes: referenceBytes.length,
              }),
            );

            const filePath = path.isAbsolute(asset.storagePath)
              ? asset.storagePath
              : path.join(storageRoot, asset.storagePath);
            await expect(readFile(filePath)).resolves.toEqual(referenceBytes);
          },
          {
            STORAGE_ROOT: storageRoot,
          },
        );
      } finally {
        await rm(storageRoot, { recursive: true, force: true });
      }
    });
  });

  it("rejects multipart requests without content-length before parsing formData", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-images-api-bound-"));

      try {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const user = await createActiveUser(prisma, "images-bound-owner");
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Images Bound Project",
              },
            });
            const session = await insertSessionForUser(prisma, user.id);
            vi.resetModules();
            const route = await loadRouteModule<{
              POST: (request: Request) => Promise<Response>;
            }>("src/app/api/images/route.ts", {
              sessionToken: session.token,
            });

            const formDataSpy = vi.fn(async () => {
              throw new Error("formData should not be called");
            });

            const response = await route.POST(
              {
                url: "http://localhost/api/images",
                headers: new Headers({
                  "content-type": "multipart/form-data; boundary=----vitest",
                }),
                formData: formDataSpy,
              } as unknown as Request,
            );

            expect(response.status).toBe(413);
            expect(formDataSpy).not.toHaveBeenCalled();

            await expect(response.json()).resolves.toEqual(
              expect.objectContaining({
                error: expect.stringMatching(/content-length/i),
              }),
            );

            expect(
              await prisma.task.count({
                where: {
                  projectId: project.id,
                },
              }),
            ).toBe(0);
          },
          {
            STORAGE_ROOT: storageRoot,
          },
        );
      } finally {
        await rm(storageRoot, { recursive: true, force: true });
      }
    });
  });
});
