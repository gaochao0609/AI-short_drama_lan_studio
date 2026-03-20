import process from "node:process";
import { startWorkerRuntime } from "@/worker/index";

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
