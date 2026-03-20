import { createMinimalWorker } from "@/worker/processors/shared";

export function createStoryboardWorker() {
  return createMinimalWorker("storyboard-queue");
}
