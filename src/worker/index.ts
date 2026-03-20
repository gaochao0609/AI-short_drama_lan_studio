import { Worker } from "bullmq";
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

  await waitForWorkerStartup(workers);

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
