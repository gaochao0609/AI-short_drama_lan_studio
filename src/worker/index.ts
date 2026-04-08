import process from "node:process";
import { fileURLToPath } from "node:url";
import { Worker } from "bullmq";
import { waitForDatabase } from "@/lib/db";
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
  await waitForDatabase();

  const [
    { createScriptWorker },
    { createAssetScriptParseWorker },
    { createStoryboardWorker },
    { createImageWorker },
    { createVideoWorker },
  ] = await Promise.all([
    import("@/worker/processors/script"),
    import("@/worker/processors/asset-script-parse"),
    import("@/worker/processors/storyboard"),
    import("@/worker/processors/image"),
    import("@/worker/processors/video"),
  ]);

  const workers = [
    createScriptWorker(),
    createAssetScriptParseWorker(),
    createStoryboardWorker(),
    createImageWorker(),
    createVideoWorker(),
  ];

  await waitForWorkerStartup(workers);

  for (const worker of workers) {
    console.log(`[worker] started ${worker.name}`);
  }

  return {
    workers,
    close: async () => {
      await Promise.all(workers.map((worker) => worker.close()));
    },
  };
}

async function waitForWorkerStartup(workers: Worker[]) {
  let onError: ((error: Error) => void) | undefined;
  const readyPromise = Promise.all(workers.map((worker) => worker.waitUntilReady()));
  const errorPromise = new Promise<never>((_, reject) => {
    onError = (error: Error) => {
      if (onError === undefined) {
        return;
      }

      const errorListener = onError;
      onError = undefined;
      for (const worker of workers) {
        worker.off("error", errorListener);
      }
      reject(error);
    };

    for (const worker of workers) {
      worker.once("error", onError);
    }
  });

  try {
    await Promise.race([readyPromise, errorPromise]);
  } catch (error) {
    await Promise.allSettled(workers.map((worker) => worker.close()));
    throw error;
  } finally {
    if (onError) {
      for (const worker of workers) {
        worker.off("error", onError);
      }
    }
  }
}

function isWorkerEntrypoint() {
  if (!process.argv[1]) {
    return false;
  }

  return fileURLToPath(import.meta.url) === process.argv[1];
}

if (isWorkerEntrypoint()) {
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
