import path from "node:path";

function requireStorageRoot() {
  const storageRoot = process.env.STORAGE_ROOT;

  if (!storageRoot) {
    throw new Error("STORAGE_ROOT is required");
  }

  return path.resolve(storageRoot);
}

export function getStorageRoot() {
  return requireStorageRoot();
}

export function normalizeStoredPath(storagePath: string) {
  return path.posix.normalize(storagePath.replaceAll("\\", "/"));
}

export function toStoredPath(storageRoot: string, filePath: string) {
  return normalizeStoredPath(path.relative(storageRoot, filePath));
}

export function resolveStoredPath(storageRoot: string, storagePath: string) {
  if (path.isAbsolute(storagePath)) {
    return path.resolve(storagePath);
  }

  const normalized = normalizeStoredPath(storagePath);

  if (path.posix.isAbsolute(normalized)) {
    return path.resolve(normalized);
  }

  return path.resolve(storageRoot, normalized);
}

export function getTempDir() {
  return path.join(getStorageRoot(), "tmp");
}

export function getUploadsDir(projectId: string, taskId: string) {
  return path.join(getStorageRoot(), "uploads", projectId, taskId);
}

export function getGeneratedImagesDir(projectId: string, taskId: string) {
  return path.join(getStorageRoot(), "generated-images", projectId, taskId);
}

export function getGeneratedVideosDir(projectId: string, taskId: string) {
  return path.join(getStorageRoot(), "generated-videos", projectId, taskId);
}

export function getExportsDir(projectId: string) {
  return path.join(getStorageRoot(), "exports", projectId);
}
