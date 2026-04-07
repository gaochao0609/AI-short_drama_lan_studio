import { Buffer } from "node:buffer";
import { AssetCategory, AssetOrigin, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

type BackfilledAsset = {
  id: string;
  projectId: string;
  category: AssetCategory | null;
  origin: AssetOrigin | null;
};

type BackfilledBinding = {
  id: string;
  projectId: string;
  storyboardScriptAssetId: string | null;
};

export type AssetCenterBackfillResult = {
  createdAssets: BackfilledAsset[];
  updatedAssets: BackfilledAsset[];
  createdBindings: BackfilledBinding[];
  updatedBindings: BackfilledBinding[];
};

function getNormalizedCategoryAndOrigin(input: { mimeType: string; taskId: string | null }) {
  if (input.mimeType.startsWith("image/")) {
    if (input.taskId) {
      return {
        category: AssetCategory.IMAGE_GENERATED,
        origin: AssetOrigin.SYSTEM,
      };
    }

    return {
      category: AssetCategory.IMAGE_SOURCE,
      origin: AssetOrigin.UPLOAD,
    };
  }

  if (input.mimeType.startsWith("video/")) {
    return {
      category: AssetCategory.VIDEO_GENERATED,
      origin: AssetOrigin.SYSTEM,
    };
  }

  return null;
}

export async function backfillAssetCenter(
  input: { prisma?: PrismaClient } = {},
): Promise<AssetCenterBackfillResult> {
  const db = input.prisma ?? prisma;
  const result: AssetCenterBackfillResult = {
    createdAssets: [],
    updatedAssets: [],
    createdBindings: [],
    updatedBindings: [],
  };
  const scriptAssetByFinalScriptVersionId = new Map<string, string>();
  const defaultScriptAssetByProjectId = new Map<string, string>();
  const sessionsWithFinalScripts = await db.scriptSession.findMany({
    where: {
      finalScriptVersionId: {
        not: null,
      },
    },
    orderBy: [
      {
        completedAt: "desc",
      },
      {
        updatedAt: "desc",
      },
    ],
    select: {
      id: true,
      projectId: true,
      finalScriptVersionId: true,
      finalScriptVersion: {
        select: {
          id: true,
          versionNumber: true,
          body: true,
        },
      },
    },
  });

  for (const session of sessionsWithFinalScripts) {
    if (!session.finalScriptVersionId || !session.finalScriptVersion) {
      continue;
    }

    let scriptAssetId = scriptAssetByFinalScriptVersionId.get(session.finalScriptVersionId) ?? null;

    if (!scriptAssetId) {
      const existingAsset = await db.asset.findFirst({
        where: {
          projectId: session.projectId,
          category: AssetCategory.SCRIPT_GENERATED,
          metadata: {
            path: ["scriptVersionId"],
            equals: session.finalScriptVersionId,
          },
        },
        select: {
          id: true,
        },
      });

      if (existingAsset) {
        scriptAssetId = existingAsset.id;
      } else {
        const extractedText = session.finalScriptVersion.body ?? "";
        const createdAsset = await db.asset.create({
          data: {
            projectId: session.projectId,
            kind: "script",
            category: AssetCategory.SCRIPT_GENERATED,
            origin: AssetOrigin.SYSTEM,
            storagePath: `backfill/scripts/${session.finalScriptVersion.id}.txt`,
            originalName: `final-script-v${session.finalScriptVersion.versionNumber}.txt`,
            mimeType: "text/plain",
            sizeBytes: Buffer.byteLength(extractedText, "utf8"),
            metadata: {
              parseStatus: "ready",
              scriptSessionId: session.id,
              scriptVersionId: session.finalScriptVersion.id,
              extractedText,
            },
          },
          select: {
            id: true,
            projectId: true,
            category: true,
            origin: true,
          },
        });

        result.createdAssets.push(createdAsset);
        scriptAssetId = createdAsset.id;
      }

      scriptAssetByFinalScriptVersionId.set(session.finalScriptVersionId, scriptAssetId);
    }

    if (!defaultScriptAssetByProjectId.has(session.projectId)) {
      defaultScriptAssetByProjectId.set(session.projectId, scriptAssetId);
    }
  }

  const legacyAssets = await db.asset.findMany({
    where: {
      OR: [
        {
          mimeType: {
            startsWith: "image/",
          },
          OR: [
            {
              category: null,
            },
            {
              origin: null,
            },
          ],
        },
        {
          mimeType: {
            startsWith: "video/",
          },
          OR: [
            {
              category: null,
            },
            {
              origin: null,
            },
          ],
        },
      ],
    },
    select: {
      id: true,
      projectId: true,
      mimeType: true,
      taskId: true,
      category: true,
      origin: true,
    },
  });

  for (const asset of legacyAssets) {
    const normalized = getNormalizedCategoryAndOrigin({
      mimeType: asset.mimeType,
      taskId: asset.taskId,
    });

    if (!normalized) {
      continue;
    }

    if (asset.category === normalized.category && asset.origin === normalized.origin) {
      continue;
    }

    const updatedAsset = await db.asset.update({
      where: {
        id: asset.id,
      },
      data: {
        category: normalized.category,
        origin: normalized.origin,
      },
      select: {
        id: true,
        projectId: true,
        category: true,
        origin: true,
      },
    });

    result.updatedAssets.push(updatedAsset);
  }

  const [projects, existingBindings] = await Promise.all([
    db.project.findMany({
      select: {
        id: true,
      },
    }),
    db.projectWorkflowBinding.findMany({
      select: {
        id: true,
        projectId: true,
        storyboardScriptAssetId: true,
      },
    }),
  ]);
  const existingBindingByProjectId = new Map(
    existingBindings.map((binding) => [binding.projectId, binding]),
  );

  for (const project of projects) {
    const storyboardScriptAssetId = defaultScriptAssetByProjectId.get(project.id) ?? null;
    const existingBinding = existingBindingByProjectId.get(project.id);

    if (!existingBinding) {
      const createdBinding = await db.projectWorkflowBinding.create({
        data: {
          projectId: project.id,
          storyboardScriptAssetId,
        },
        select: {
          id: true,
          projectId: true,
          storyboardScriptAssetId: true,
        },
      });

      result.createdBindings.push(createdBinding);
      continue;
    }

    if (existingBinding.storyboardScriptAssetId || !storyboardScriptAssetId) {
      continue;
    }

    const updatedBinding = await db.projectWorkflowBinding.update({
      where: {
        id: existingBinding.id,
      },
      data: {
        storyboardScriptAssetId,
      },
      select: {
        id: true,
        projectId: true,
        storyboardScriptAssetId: true,
      },
    });

    result.updatedBindings.push(updatedBinding);
  }

  return result;
}
