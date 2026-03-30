import path from "node:path";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { toErrorResponse } from "@/lib/services/errors";
import { cleanupOldFiles } from "@/lib/storage/fs-storage";
import { getStorageRoot } from "@/lib/storage/paths";

function readOlderThanDays(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 30;
  }

  return Math.floor(value);
}

export async function POST(request: Request) {
  try {
    await requireAdmin();

    const requestBody = (await request.json().catch(() => null)) as { olderThanDays?: unknown } | null;
    const olderThanDays = readOlderThanDays(requestBody?.olderThanDays);
    const storageRoot = getStorageRoot();
    const referencedAssets = await prisma.asset.findMany({
      select: {
        storagePath: true,
      },
    });
    const referencedPaths = referencedAssets.map((asset) =>
      path.isAbsolute(asset.storagePath)
        ? path.resolve(asset.storagePath)
        : path.resolve(storageRoot, asset.storagePath),
    );
    const result = await cleanupOldFiles({
      directories: [
        path.join(storageRoot, "tmp"),
        path.join(storageRoot, "uploads"),
        path.join(storageRoot, "generated-images"),
        path.join(storageRoot, "generated-videos"),
      ],
      olderThanMs: olderThanDays * 24 * 60 * 60 * 1000,
      referencedPaths,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
