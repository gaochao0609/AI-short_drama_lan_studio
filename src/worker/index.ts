import process from "node:process";
import { bootstrapWorkerEnv } from "@/worker/env";

export type WorkerRuntime = {
  workers: Array<{
    close: () => Promise<void>;
    name: string;
  }>;
  close: () => Promise<void>;
};

export async function startWorkerRuntime(): Promise<WorkerRuntime> {
  bootstrapWorkerEnv();

  const [
    { createScriptWorker },
    { createStoryboardWorker },
    { createImageWorker },
    { createVideoWorker },
  ] = await Promise.all([
    import("@/worker/processors/script"),
    import("@/worker/processors/storyboard"),
    import("@/worker/processors/image"),
    import("@/worker/processors/video"),
  ]);

  const workers = [createScriptWorker(), createStoryboardWorker(), createImageWorker(), createVideoWorker()];

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
  void (async () => {
    const runtime = await startWorkerRuntime();

    const shutdown = async () => {
      await runtime.close();
      process.exit(0);
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  })().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
