import process from "node:process";
import { createImageWorker } from "@/worker/processors/image";
import { createScriptWorker } from "@/worker/processors/script";
import { createStoryboardWorker } from "@/worker/processors/storyboard";
import { createVideoWorker } from "@/worker/processors/video";

export type WorkerRuntime = {
  workers: Array<{
    close: () => Promise<void>;
    name: string;
  }>;
  close: () => Promise<void>;
};

export function startWorkerRuntime(): WorkerRuntime {
  const workers = [
    createScriptWorker(),
    createStoryboardWorker(),
    createImageWorker(),
    createVideoWorker(),
  ];

  console.log(`[worker] started ${workers[0].name}`);
  console.log(`[worker] started ${workers[1].name}`);
  console.log(`[worker] started ${workers[2].name}`);
  console.log(`[worker] started ${workers[3].name}`);

  return {
    workers,
    close: async () => {
      await Promise.all(workers.map((worker) => worker.close()));
    },
  };
}

const shouldAutoStart = process.env.VITEST !== "true";

if (shouldAutoStart) {
  const runtime = startWorkerRuntime();

  const shutdown = async () => {
    await runtime.close();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
