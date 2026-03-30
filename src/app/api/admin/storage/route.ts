import path from "node:path";
import { requireAdmin } from "@/lib/auth/guards";
import { toErrorResponse } from "@/lib/services/errors";
import { getDirectoryBytes, getDiskSpaceStats } from "@/lib/storage/fs-storage";
import { getStorageRoot } from "@/lib/storage/paths";

export async function GET() {
  try {
    await requireAdmin();
    const storageRoot = getStorageRoot();
    const [disk, uploadsBytes, imagesBytes, videosBytes, exportsBytes] = await Promise.all([
      getDiskSpaceStats(storageRoot),
      getDirectoryBytes(path.join(storageRoot, "uploads")),
      getDirectoryBytes(path.join(storageRoot, "generated-images")),
      getDirectoryBytes(path.join(storageRoot, "generated-videos")),
      getDirectoryBytes(path.join(storageRoot, "exports")),
    ]);

    return Response.json(
      {
        totalBytes: disk.totalBytes,
        freeBytes: disk.freeBytes,
        uploadsBytes,
        imagesBytes,
        videosBytes,
        exportsBytes,
      },
      { status: 200 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
