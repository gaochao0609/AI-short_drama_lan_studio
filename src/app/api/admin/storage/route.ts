import path from "node:path";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { toErrorResponse } from "@/lib/services/errors";
import { getDirectoryBytes, getDirectoryFileStats, getDiskSpaceStats } from "@/lib/storage/fs-storage";
import { getStorageRoot, resolveStoredPath } from "@/lib/storage/paths";

function guessMimeTypeFromFilePath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  if ([".png", ".jpg", ".jpeg", ".webp"].includes(extension)) {
    return "image/unknown";
  }

  if ([".mp4", ".webm", ".mov", ".qt"].includes(extension)) {
    return "video/unknown";
  }

  return null;
}

export async function GET() {
  try {
    await requireAdmin();
    const storageRoot = getStorageRoot();
    const [disk, uploadsBytes, generatedImagesBytes, generatedVideosBytes, exportsBytes, assetFiles, assets] = await Promise.all([
      getDiskSpaceStats(storageRoot),
      getDirectoryBytes(path.join(storageRoot, "uploads")),
      getDirectoryBytes(path.join(storageRoot, "generated-images")),
      getDirectoryBytes(path.join(storageRoot, "generated-videos")),
      getDirectoryBytes(path.join(storageRoot, "exports")),
      getDirectoryFileStats(path.join(storageRoot, "assets")),
      prisma.asset.findMany({
        select: {
          storagePath: true,
          mimeType: true,
        },
      }),
    ]);
    const assetMimeByPath = new Map(
      assets.map((asset) => [
        path.resolve(resolveStoredPath(storageRoot, asset.storagePath)),
        asset.mimeType,
      ]),
    );
    let persistedImageBytes = 0;
    let persistedVideoBytes = 0;

    for (const assetFile of assetFiles) {
      const resolvedPath = path.resolve(assetFile.path);
      const mimeType =
        assetMimeByPath.get(resolvedPath) ?? guessMimeTypeFromFilePath(resolvedPath);

      if (mimeType?.startsWith("image/")) {
        persistedImageBytes += assetFile.sizeBytes;
        continue;
      }

      if (mimeType?.startsWith("video/")) {
        persistedVideoBytes += assetFile.sizeBytes;
      }
    }

    return Response.json(
      {
        totalBytes: disk.totalBytes,
        freeBytes: disk.freeBytes,
        uploadsBytes,
        imagesBytes: generatedImagesBytes + persistedImageBytes,
        videosBytes: generatedVideosBytes + persistedVideoBytes,
        exportsBytes,
      },
      { status: 200 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
