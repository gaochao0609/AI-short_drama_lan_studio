import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat, statfs, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getTempDir } from "@/lib/storage/paths";

export async function writeTempFile(contents: string | Buffer | Uint8Array) {
  const tempDir = getTempDir();
  await mkdir(tempDir, { recursive: true });

  const tempFilePath = path.join(tempDir, `${randomUUID()}.tmp`);
  await writeFile(tempFilePath, contents);

  return tempFilePath;
}

export async function promoteTempFile(tempFilePath: string, destinationPath: string) {
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await rename(tempFilePath, destinationPath);

  return destinationPath;
}

export async function deleteFile(filePath: string) {
  await rm(filePath, { force: true });
}

export function openReadStream(filePath: string) {
  return createReadStream(filePath);
}

function toNumber(value: bigint | number) {
  return typeof value === "bigint" ? Number(value) : value;
}

async function directoryExists(directoryPath: string) {
  try {
    const stats = await stat(directoryPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function countDirectoryBytes(directoryPath: string): Promise<number> {
  if (!(await directoryExists(directoryPath))) {
    return 0;
  }

  const entries = await readdir(directoryPath, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  });
  let total = 0;

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      total += await countDirectoryBytes(entryPath);
      continue;
    }

    if (entry.isFile()) {
      const fileStats = await stat(entryPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          return null;
        }

        throw error;
      });

      total += fileStats?.size ?? 0;
    }
  }

  return total;
}

async function listFiles(directoryPath: string): Promise<string[]> {
  if (!(await directoryExists(directoryPath))) {
    return [];
  }

  const entries = await readdir(directoryPath, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFiles(entryPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

export async function getDirectoryFileStats(directoryPath: string) {
  const files = await listFiles(directoryPath);

  const fileStats = await Promise.all(
    files.map(async (filePath) => {
      const nextStats = await stat(filePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          return null;
        }

        throw error;
      });

      if (!nextStats) {
        return null;
      }

      return {
        path: filePath,
        sizeBytes: nextStats.size,
      };
    }),
  );

  return fileStats.filter((entry): entry is { path: string; sizeBytes: number } => entry !== null);
}

async function removeEmptyDirectories(directoryPath: string, stopAtPath: string) {
  let currentPath = directoryPath;
  const stopAt = path.resolve(stopAtPath);

  while (path.resolve(currentPath).startsWith(stopAt) && path.resolve(currentPath) !== stopAt) {
    const entries = await readdir(currentPath).catch(() => []);

    if (entries.length > 0) {
      return;
    }

    await rm(currentPath, { recursive: false, force: true }).catch(() => undefined);
    currentPath = path.dirname(currentPath);
  }
}

export async function getDiskSpaceStats(targetPath: string) {
  let candidatePath = path.resolve(targetPath);
  const rootPath = path.parse(candidatePath).root;

  while (candidatePath !== rootPath) {
    const candidateStats = await stat(candidatePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return null;
      }

      throw error;
    });

    if (candidateStats) {
      break;
    }

    candidatePath = path.dirname(candidatePath);
  }

  const stats = await statfs(candidatePath);
  const blockSize = toNumber(stats.bsize);
  const totalBlocks = toNumber(stats.blocks);
  const freeBlocks = toNumber(stats.bavail);

  return {
    totalBytes: totalBlocks * blockSize,
    freeBytes: freeBlocks * blockSize,
  };
}

export async function getDirectoryBytes(directoryPath: string) {
  return countDirectoryBytes(directoryPath);
}

export async function cleanupOldFiles(input: {
  directories: string[];
  olderThanMs: number;
  referencedPaths?: Iterable<string>;
}) {
  const cutoff = Date.now() - input.olderThanMs;
  const referencedPaths = new Set(
    [...(input.referencedPaths ?? [])].map((value) => path.resolve(value)),
  );
  let deletedFiles = 0;
  let freedBytes = 0;

  for (const directoryPath of input.directories) {
    const files = await listFiles(directoryPath);

    for (const filePath of files) {
      const resolvedPath = path.resolve(filePath);

      if (referencedPaths.has(resolvedPath)) {
        continue;
      }

      const fileStats = await stat(resolvedPath).catch(() => null);

      if (!fileStats?.isFile() || fileStats.mtimeMs >= cutoff) {
        continue;
      }

      await unlink(resolvedPath);
      deletedFiles += 1;
      freedBytes += fileStats.size;
      await removeEmptyDirectories(path.dirname(resolvedPath), directoryPath);
    }
  }

  return {
    deletedFiles,
    freedBytes,
  };
}
