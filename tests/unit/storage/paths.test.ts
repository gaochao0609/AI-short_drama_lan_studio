import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeStoredPath,
  resolveStoredPath,
  toStoredPath,
} from "@/lib/storage/paths";

describe("storage paths", () => {
  it("normalizes stored paths to POSIX separators", () => {
    expect(normalizeStoredPath("assets\\project-1\\task-1\\image.png")).toBe(
      "assets/project-1/task-1/image.png",
    );
  });

  it("resolves legacy backslash storage paths against the storage root", () => {
    const storageRoot = path.join("tmp", "storage-root");

    expect(resolveStoredPath(storageRoot, "assets\\project-1\\legacy\\image.png")).toBe(
      path.resolve(storageRoot, "assets/project-1/legacy/image.png"),
    );
  });

  it("stores new relative asset paths using POSIX separators", () => {
    const storageRoot = path.join("tmp", "storage-root");
    const destinationPath = path.join(
      storageRoot,
      "assets",
      "project-1",
      "task-1",
      "image.png",
    );

    expect(toStoredPath(storageRoot, destinationPath)).toBe(
      "assets/project-1/task-1/image.png",
    );
  });
});
