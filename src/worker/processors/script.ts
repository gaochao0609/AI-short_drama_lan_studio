import { TaskType } from "@prisma/client";
import { createMinimalWorker } from "@/worker/processors/shared";

export function createScriptWorker() {
  return createMinimalWorker("script-queue", {
    concurrency: 5,
    expectedJobName: TaskType.SCRIPT_FINALIZE,
  });
}
