import { createMinimalWorker } from "@/worker/processors/shared";

export function createImageWorker() {
  return createMinimalWorker("image-queue");
}
