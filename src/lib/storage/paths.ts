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
