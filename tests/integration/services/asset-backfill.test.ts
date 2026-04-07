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
