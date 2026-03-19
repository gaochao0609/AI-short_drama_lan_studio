import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
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
