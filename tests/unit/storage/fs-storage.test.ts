import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("fs storage", () => {
  let previousStorageRoot: string | undefined;
  let storageRoot: string;

  beforeEach(async () => {
    previousStorageRoot = process.env.STORAGE_ROOT;
    storageRoot = await mkdtemp(path.join(os.tmpdir(), "lan-studio-storage-"));
    process.env.STORAGE_ROOT = storageRoot;
    vi.resetModules();
  });

  afterEach(async () => {
    if (previousStorageRoot === undefined) {
      delete process.env.STORAGE_ROOT;
    } else {
      process.env.STORAGE_ROOT = previousStorageRoot;
    }

    await rm(storageRoot, { recursive: true, force: true });
    vi.resetModules();
  });

  it("builds project and task storage directories from STORAGE_ROOT", async () => {
    const {
      getExportsDir,
      getGeneratedImagesDir,
      getGeneratedVideosDir,
      getUploadsDir,
    } = await import("@/lib/storage/paths");

    expect(getUploadsDir("project-1", "task-1")).toBe(
      path.join(storageRoot, "uploads", "project-1", "task-1"),
    );
    expect(getGeneratedImagesDir("project-1", "task-1")).toBe(
      path.join(storageRoot, "generated-images", "project-1", "task-1"),
    );
    expect(getGeneratedVideosDir("project-1", "task-1")).toBe(
      path.join(storageRoot, "generated-videos", "project-1", "task-1"),
    );
    expect(getExportsDir("project-1")).toBe(path.join(storageRoot, "exports", "project-1"));
  });

  it("writes, promotes, reads, and deletes files under STORAGE_ROOT", async () => {
    const { getGeneratedImagesDir } = await import("@/lib/storage/paths");
    const { deleteFile, openReadStream, promoteTempFile, writeTempFile } = await import(
      "@/lib/storage/fs-storage"
    );

    const tempFilePath = await writeTempFile("frame payload");
    await expect(readFile(tempFilePath, "utf8")).resolves.toBe("frame payload");

    const targetPath = path.join(getGeneratedImagesDir("project-1", "task-9"), "frame-1.txt");
    const promotedPath = await promoteTempFile(tempFilePath, targetPath);

    expect(promotedPath).toBe(targetPath);
    await expect(readFile(promotedPath, "utf8")).resolves.toBe("frame payload");

    const stream = openReadStream(promotedPath);
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    expect(Buffer.concat(chunks).toString("utf8")).toBe("frame payload");

    await deleteFile(promotedPath);
    await expect(stat(promotedPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
