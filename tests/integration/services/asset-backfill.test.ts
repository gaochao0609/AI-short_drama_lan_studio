import {
  AssetCategory,
  AssetOrigin,
  ScriptSessionStatus,
  TaskStatus,
  TaskType,
  UserRole,
  UserStatus,
} from "@prisma/client";
import { describe, expect, it } from "vitest";
import { withTestDatabase } from "../db/test-database";

describe("asset backfill service", () => {
  it("backfills one generated script asset per historical final script version in the same project", async () => {
    await withTestDatabase(async ({ prisma }) => {
      const owner = await prisma.user.create({
        data: {
          username: "asset-backfill-multi-final-owner",
          passwordHash: "hash",
          role: UserRole.USER,
          status: UserStatus.ACTIVE,
          forcePasswordChange: false,
        },
      });
      const project = await prisma.project.create({
        data: {
          ownerId: owner.id,
          title: "Project With Multiple Final Scripts",
        },
      });
      const [firstFinalScriptVersion, secondFinalScriptVersion] = await Promise.all([
        prisma.scriptVersion.create({
          data: {
            projectId: project.id,
            creatorId: owner.id,
            versionNumber: 1,
            title: "Final Script V1",
            body: "INT. CABIN - DAWN",
            scriptJson: { scenes: [] },
            summary: "First finalized script",
          },
        }),
        prisma.scriptVersion.create({
          data: {
            projectId: project.id,
            creatorId: owner.id,
            versionNumber: 2,
            title: "Final Script V2",
            body: "EXT. CITY - NIGHT",
            scriptJson: { scenes: [] },
            summary: "Second finalized script",
          },
        }),
      ]);
      await prisma.scriptSession.create({
        data: {
          projectId: project.id,
          creatorId: owner.id,
          idea: "First ending",
          status: ScriptSessionStatus.COMPLETED,
          completedRounds: 3,
          qaRecordsJson: [],
          finalScriptVersionId: firstFinalScriptVersion.id,
          completedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      });
      await prisma.scriptSession.create({
        data: {
          projectId: project.id,
          creatorId: owner.id,
          idea: "Second ending",
          status: ScriptSessionStatus.COMPLETED,
          completedRounds: 3,
          qaRecordsJson: [],
          finalScriptVersionId: secondFinalScriptVersion.id,
          completedAt: new Date("2026-02-01T00:00:00.000Z"),
        },
      });

      const { backfillAssetCenter } = await import("@/lib/services/asset-backfill");

      const firstRun = await backfillAssetCenter({ prisma });
      const generatedScriptAssets = await prisma.asset.findMany({
        where: {
          projectId: project.id,
          category: AssetCategory.SCRIPT_GENERATED,
        },
      });
      const generatedScriptVersionIds = generatedScriptAssets
        .map((asset) => {
          const metadata = asset.metadata as null | { scriptVersionId?: string };
          return metadata?.scriptVersionId ?? null;
        })
        .filter((value): value is string => typeof value === "string")
        .sort();
      const workflowBinding = await prisma.projectWorkflowBinding.findUniqueOrThrow({
        where: {
          projectId: project.id,
        },
      });
      const secondScriptAsset = generatedScriptAssets.find((asset) => {
        const metadata = asset.metadata as null | { scriptVersionId?: string };
        return metadata?.scriptVersionId === secondFinalScriptVersion.id;
      });

      expect(firstRun.createdAssets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            projectId: project.id,
            category: AssetCategory.SCRIPT_GENERATED,
            origin: AssetOrigin.SYSTEM,
          }),
        ]),
      );
      expect(generatedScriptAssets).toHaveLength(2);
      expect(generatedScriptVersionIds).toEqual(
        [firstFinalScriptVersion.id, secondFinalScriptVersion.id].sort(),
      );
      expect(workflowBinding.storyboardScriptAssetId).toBe(secondScriptAsset?.id ?? null);

      const secondRun = await backfillAssetCenter({ prisma });

      expect(secondRun.createdAssets).toHaveLength(0);
      expect(secondRun.updatedAssets).toHaveLength(0);
      expect(secondRun.createdBindings).toHaveLength(0);
      expect(secondRun.updatedBindings).toHaveLength(0);
    });
  });

  it("backfills generated script assets, normalizes legacy media assets, and remains idempotent", async () => {
    await withTestDatabase(async ({ prisma }) => {
      const owner = await prisma.user.create({
        data: {
          username: "asset-backfill-owner",
          passwordHash: "hash",
          role: UserRole.USER,
          status: UserStatus.ACTIVE,
          forcePasswordChange: false,
        },
      });
      const [projectWithFinalScript, projectWithoutFinalScript] = await Promise.all([
        prisma.project.create({
          data: {
            ownerId: owner.id,
            title: "Project With Final Script",
          },
        }),
        prisma.project.create({
          data: {
            ownerId: owner.id,
            title: "Project Without Final Script",
          },
        }),
      ]);
      const finalScriptVersion = await prisma.scriptVersion.create({
        data: {
          projectId: projectWithFinalScript.id,
          creatorId: owner.id,
          versionNumber: 2,
          title: "Final Script",
          body: "INT. ROOFTOP - NIGHT\nThe rain starts as the hero arrives.",
          scriptJson: {
            scenes: [],
          },
          summary: "Finalized rooftop scene",
        },
      });
      await prisma.scriptSession.create({
        data: {
          projectId: projectWithFinalScript.id,
          creatorId: owner.id,
          idea: "Rooftop showdown",
          status: ScriptSessionStatus.COMPLETED,
          completedRounds: 3,
          qaRecordsJson: [],
          finalScriptVersionId: finalScriptVersion.id,
          completedAt: new Date(),
        },
      });
      const [imageTask, videoTask] = await Promise.all([
        prisma.task.create({
          data: {
            projectId: projectWithFinalScript.id,
            createdById: owner.id,
            type: TaskType.IMAGE,
            status: TaskStatus.SUCCEEDED,
            inputJson: { prompt: "Legacy image task" },
          },
        }),
        prisma.task.create({
          data: {
            projectId: projectWithFinalScript.id,
            createdById: owner.id,
            type: TaskType.VIDEO,
            status: TaskStatus.SUCCEEDED,
            inputJson: { prompt: "Legacy video task" },
          },
        }),
      ]);
      const [legacyUploadedImage, legacyGeneratedImage, legacyGeneratedVideo] = await Promise.all([
        prisma.asset.create({
          data: {
            projectId: projectWithFinalScript.id,
            kind: "image",
            storagePath: "legacy/uploaded-image.png",
            originalName: "uploaded-image.png",
            mimeType: "image/png",
            sizeBytes: 512,
          },
        }),
        prisma.asset.create({
          data: {
            projectId: projectWithFinalScript.id,
            taskId: imageTask.id,
            kind: "image",
            storagePath: "legacy/generated-image.png",
            originalName: "generated-image.png",
            mimeType: "image/png",
            sizeBytes: 1024,
          },
        }),
        prisma.asset.create({
          data: {
            projectId: projectWithFinalScript.id,
            taskId: videoTask.id,
            kind: "video",
            storagePath: "legacy/generated-video.mp4",
            originalName: "generated-video.mp4",
            mimeType: "video/mp4",
            sizeBytes: 4096,
          },
        }),
      ]);

      const { backfillAssetCenter } = await import("@/lib/services/asset-backfill");

      const firstRun = await backfillAssetCenter({ prisma });
      const generatedScriptAsset = await prisma.asset.findFirstOrThrow({
        where: {
          projectId: projectWithFinalScript.id,
          category: AssetCategory.SCRIPT_GENERATED,
          origin: AssetOrigin.SYSTEM,
        },
      });
      const workflowBindingWithFinal = await prisma.projectWorkflowBinding.findUniqueOrThrow({
        where: {
          projectId: projectWithFinalScript.id,
        },
      });
      const workflowBindingWithoutFinal = await prisma.projectWorkflowBinding.findUniqueOrThrow({
        where: {
          projectId: projectWithoutFinalScript.id,
        },
      });
      const normalizedAssets = await prisma.asset.findMany({
        where: {
          id: {
            in: [legacyUploadedImage.id, legacyGeneratedImage.id, legacyGeneratedVideo.id],
          },
        },
      });

      expect(firstRun.createdAssets).not.toHaveLength(0);
      expect(generatedScriptAsset.category).toBe(AssetCategory.SCRIPT_GENERATED);
      expect(generatedScriptAsset.origin).toBe(AssetOrigin.SYSTEM);
      expect(generatedScriptAsset.metadata).toEqual(
        expect.objectContaining({
          parseStatus: "ready",
          scriptVersionId: finalScriptVersion.id,
          extractedText: expect.stringContaining("INT. ROOFTOP"),
        }),
      );
      expect(workflowBindingWithFinal.storyboardScriptAssetId).toBe(generatedScriptAsset.id);
      expect(workflowBindingWithoutFinal.storyboardScriptAssetId).toBeNull();
      expect(normalizedAssets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: legacyUploadedImage.id,
            category: AssetCategory.IMAGE_SOURCE,
            origin: AssetOrigin.UPLOAD,
          }),
          expect.objectContaining({
            id: legacyGeneratedImage.id,
            category: AssetCategory.IMAGE_GENERATED,
            origin: AssetOrigin.SYSTEM,
          }),
          expect.objectContaining({
            id: legacyGeneratedVideo.id,
            category: AssetCategory.VIDEO_GENERATED,
            origin: AssetOrigin.SYSTEM,
          }),
        ]),
      );

      const secondRun = await backfillAssetCenter({ prisma });

      expect(secondRun.createdAssets).toHaveLength(0);
      expect(secondRun.updatedAssets).toHaveLength(0);
      expect(secondRun.createdBindings).toHaveLength(0);
      expect(secondRun.updatedBindings).toHaveLength(0);
      expect(
        await prisma.asset.count({
          where: {
            projectId: projectWithFinalScript.id,
            category: AssetCategory.SCRIPT_GENERATED,
          },
        }),
      ).toBe(1);
    });
  });
});
