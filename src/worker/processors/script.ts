import { createMinimalWorker } from "@/worker/processors/shared";

export function createScriptWorker() {
  return createMinimalWorker("script-queue");
}
