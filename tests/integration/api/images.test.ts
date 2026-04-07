import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { AssetCategory, AssetOrigin, UserRole, UserStatus, type PrismaClient } from "@prisma/client";
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

async function createImageAsset(
  prisma: PrismaClient,
  input: {
    projectId: string;
    storageRoot: string;
    fileName: string;
    createdAt: string;
    category?: AssetCategory;
    origin?: AssetOrigin;
  },
) {
  const relativePath = path.join("assets", input.projectId, "images", input.fileName);
  const absolutePath = path.join(input.storageRoot, relativePath);
  const bytes = Buffer.from(`image-${input.fileName}`);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);

  return prisma.asset.create({
    data: {
      projectId: input.projectId,
      kind: input.category === AssetCategory.IMAGE_GENERATED ? "image_generated" : "image_reference",
      category: input.category ?? AssetCategory.IMAGE_SOURCE,
      origin: input.origin ?? AssetOrigin.UPLOAD,
      storagePath: relativePath,
      originalName: input.fileName,
      mimeType: "image/png",
      sizeBytes: bytes.length,
      createdAt: new Date(input.createdAt),
    },
  });
}

afterEach(() => {
  vi.doUnmock("next/headers");
  vi.resetModules();
});

describe("images workspace api", () => {
  it("returns binding-aware workspace data with default and candidate reference assets", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-images-api-"));

      try {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const user = await createActiveUser(prisma, "images-workspace-owner");
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Images Workspace",
              },
            });

            const candidateA = await createImageAsset(prisma, {
              projectId: project.id,
              storageRoot,
              fileName: "candidate-a.png",
              createdAt: "2026-04-07T10:00:00.000Z",
            });
            const candidateB = await createImageAsset(prisma, {
              projectId: project.id,
              storageRoot,
              fileName: "candidate-b.png",
              createdAt: "2026-04-07T11:00:00.000Z",
            });
            const generatedImage = await createImageAsset(prisma, {
              projectId: project.id,
              storageRoot,
              fileName: "generated.png",
              createdAt: "2026-04-07T12:00:00.000Z",
              category: AssetCategory.IMAGE_GENERATED,
              origin: AssetOrigin.SYSTEM,
            });

            await prisma.projectWorkflowBinding.create({
              data: {
                projectId: project.id,
                imageReferenceAssetIds: [candidateB.id, candidateA.id],
              },
            });

            const session = await insertSessionForUser(prisma, user.id);
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
            await expect(response.json()).resolves.toEqual(
              expect.objectContaining({
                project: expect.objectContaining({
                  id: project.id,
                  title: "Images Workspace",
                }),
                maxUploadMb: 25,
                binding: {
                  imageReferenceAssetIds: [candidateB.id, candidateA.id],
                },
                defaultReferenceAssets: [
                  expect.objectContaining({ id: candidateB.id, originalName: "candidate-b.png" }),
                  expect.objectContaining({ id: candidateA.id, originalName: "candidate-a.png" }),
                ],
                referenceAssets: [
                  expect.objectContaining({ id: generatedImage.id, originalName: "generated.png" }),
                  expect.objectContaining({ id: candidateB.id, originalName: "candidate-b.png" }),
                  expect.objectContaining({ id: candidateA.id, originalName: "candidate-a.png" }),
                ],
                assets: [expect.objectContaining({ id: generatedImage.id, originalName: "generated.png" })],
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

  it("force-includes bound default reference assets outside the candidate query window", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-images-api-bound-window-"));

      try {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const user = await createActiveUser(prisma, "images-bound-window-owner");
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Images Bound Window",
              },
            });

            const boundAsset = await createImageAsset(prisma, {
              projectId: project.id,
              storageRoot,
              fileName: "bound-old.png",
              createdAt: "2026-01-01T00:00:00.000Z",
            });

            for (let index = 0; index < 50; index += 1) {
              await createImageAsset(prisma, {
                projectId: project.id,
                storageRoot,
                fileName: `candidate-${index}.png`,
                createdAt: `2026-04-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
              });
            }

            await prisma.projectWorkflowBinding.create({
              data: {
                projectId: project.id,
                imageReferenceAssetIds: [boundAsset.id],
              },
            });

            const session = await insertSessionForUser(prisma, user.id);
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
            const payload = (await response.json()) as {
              binding: { imageReferenceAssetIds: string[] };
              defaultReferenceAssets: Array<{ id: string; originalName: string | null }>;
              referenceAssets: Array<{ id: string; originalName: string | null }>;
            };

            expect(payload.binding.imageReferenceAssetIds).toEqual([boundAsset.id]);
            expect(payload.defaultReferenceAssets).toEqual([
              expect.objectContaining({
                id: boundAsset.id,
                originalName: "bound-old.png",
              }),
            ]);
            expect(payload.referenceAssets).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  id: boundAsset.id,
                  originalName: "bound-old.png",
                }),
              ]),
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

  it("accepts ordered one-off reference asset overrides for image generation", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-images-api-post-"));

      try {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const user = await createActiveUser(prisma, "images-post-owner");
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Images Post Project",
              },
            });
            const assetA = await createImageAsset(prisma, {
              projectId: project.id,
              storageRoot,
              fileName: "asset-a.png",
              createdAt: "2026-04-07T10:00:00.000Z",
            });
            const assetB = await createImageAsset(prisma, {
              projectId: project.id,
              storageRoot,
              fileName: "asset-b.png",
              createdAt: "2026-04-07T11:00:00.000Z",
            });
            const session = await insertSessionForUser(prisma, user.id);
            const route = await loadRouteModule<{
              POST: (request: Request) => Promise<Response>;
            }>("src/app/api/images/route.ts", {
              sessionToken: session.token,
            });

            const form = new FormData();
            form.set("projectId", project.id);
            form.set("prompt", "Make the scene brighter.");
            form.append("referenceAssetIds", assetB.id);
            form.append("referenceAssetIds", assetA.id);

            const response = await route.POST(
              {
                url: "http://localhost/api/images",
                headers: new Headers({
                  "content-type": "multipart/form-data; boundary=----vitest",
                  "content-length": "1024",
                }),
                formData: async () => form,
              } as unknown as Request,
            );

            expect(response.status).toBe(202);
            const payload = (await response.json()) as { taskId: string };
            const task = await prisma.task.findUniqueOrThrow({
              where: {
                id: payload.taskId,
              },
            });

            expect(task.inputJson).toEqual(
              expect.objectContaining({
                projectId: project.id,
                userId: user.id,
                prompt: "Make the scene brighter.",
                mode: "image_edit",
                referenceAssetIds: [assetB.id, assetA.id],
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

  it("rejects image generation requests with more than eight ordered one-off references", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-images-api-post-limit-"));

      try {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const user = await createActiveUser(prisma, "images-post-limit-owner");
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Images Post Limit Project",
              },
            });
            const referenceAssets = await Promise.all(
              Array.from({ length: 9 }, (_, index) =>
                createImageAsset(prisma, {
                  projectId: project.id,
                  storageRoot,
                  fileName: `asset-${index + 1}.png`,
                  createdAt: `2026-04-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
                }),
              ),
            );
            const session = await insertSessionForUser(prisma, user.id);
            const route = await loadRouteModule<{
              POST: (request: Request) => Promise<Response>;
            }>("src/app/api/images/route.ts", {
              sessionToken: session.token,
            });

            const form = new FormData();
            form.set("projectId", project.id);
            form.set("prompt", "Make the scene brighter.");

            for (const asset of referenceAssets) {
              form.append("referenceAssetIds", asset.id);
            }

            const response = await route.POST(
              {
                url: "http://localhost/api/images",
                headers: new Headers({
                  "content-type": "multipart/form-data; boundary=----vitest",
                  "content-length": "1024",
                }),
                formData: async () => form,
              } as unknown as Request,
            );

            expect(response.status).toBe(400);
            await expect(response.json()).resolves.toEqual(
              expect.objectContaining({
                error: expect.stringMatching(/8/),
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

  it("still supports text-to-image requests when no reference assets are provided", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      await withApiTestEnv(databaseUrl, async () => {
        const user = await createActiveUser(prisma, "images-text-only-owner");
        const project = await prisma.project.create({
          data: {
            ownerId: user.id,
            title: "Images Text Only",
          },
        });
        const session = await insertSessionForUser(prisma, user.id);
        const route = await loadRouteModule<{
          POST: (request: Request) => Promise<Response>;
        }>("src/app/api/images/route.ts", {
          sessionToken: session.token,
        });

        const form = new FormData();
        form.set("projectId", project.id);
        form.set("prompt", "Generate a poster with no reference image.");

        const response = await route.POST(
          {
            url: "http://localhost/api/images",
            headers: new Headers({
              "content-type": "multipart/form-data; boundary=----vitest",
              "content-length": "512",
            }),
            formData: async () => form,
          } as unknown as Request,
        );

        expect(response.status).toBe(202);
        const payload = (await response.json()) as { taskId: string };
        const task = await prisma.task.findUniqueOrThrow({
          where: {
            id: payload.taskId,
          },
        });

        expect(task.inputJson).toEqual(
          expect.objectContaining({
            projectId: project.id,
            userId: user.id,
            prompt: "Generate a poster with no reference image.",
            mode: "image_generate",
          }),
        );
        expect(task.inputJson).not.toEqual(
          expect.objectContaining({
            referenceAssetIds: expect.anything(),
          }),
        );
      });
    });
  });

  it("rejects page-local source file uploads and requires asset-center asset ids instead", async () => {
    await withTestDatabase(async ({ databaseUrl, prisma }) => {
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-images-api-source-file-"));

      try {
        await withApiTestEnv(
          databaseUrl,
          async () => {
            const user = await createActiveUser(prisma, "images-source-file-owner");
            const project = await prisma.project.create({
              data: {
                ownerId: user.id,
                title: "Images Source File",
              },
            });
            const session = await insertSessionForUser(prisma, user.id);
            const route = await loadRouteModule<{
              POST: (request: Request) => Promise<Response>;
            }>("src/app/api/images/route.ts", {
              sessionToken: session.token,
            });

            const referenceFile = new File([Buffer.from("reference")], "reference.png", {
              type: "image/png",
            });
            const form = new FormData();
            form.set("projectId", project.id);
            form.set("prompt", "Transform this image.");
            form.set("sourceFile", referenceFile);

            const response = await route.POST(
              {
                url: "http://localhost/api/images",
                headers: new Headers({
                  "content-type": "multipart/form-data; boundary=----vitest",
                  "content-length": "1024",
                }),
                formData: async () => form,
              } as unknown as Request,
            );

            expect(response.status).toBe(400);
            await expect(response.json()).resolves.toEqual(
              expect.objectContaining({
                error: expect.stringMatching(/asset center|referenceAssetIds|sourceFile/i),
              }),
            );
            expect(
              await prisma.asset.count({
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
