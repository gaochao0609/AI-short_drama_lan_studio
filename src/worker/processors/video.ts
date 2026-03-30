import { createMinimalWorker } from "@/worker/processors/shared";

export function createVideoWorker() {
  return createMinimalWorker("video-queue", {
    concurrency: 5,
  });
}
