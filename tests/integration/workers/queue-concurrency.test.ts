import { beforeEach, describe, expect, it, vi } from "vitest";

const { workerInvocations } = vi.hoisted(() => ({
  workerInvocations: [] as Array<{ name: string; opts: { concurrency?: number } }>,
}));

vi.mock("bullmq", () => {
  class Worker {
    name: string;
    opts: { concurrency?: number };

    constructor(name: string, _processor: unknown, opts: { concurrency?: number } = {}) {
      this.name = name;
      this.opts = opts;
      workerInvocations.push({ name, opts });
    }

    async close() {
      return undefined;
    }

    async waitUntilReady() {
      return undefined;
    }

    once() {
      return this;
    }

    off() {
      return this;
    }
  }

  return {
    Worker,
  };
});

vi.mock("@/lib/redis", () => ({
  bullmqConnection: {
    url: "redis://localhost:6379/99",
    maxRetriesPerRequest: null,
  },
}));

describe("worker concurrency", () => {
  beforeEach(() => {
    workerInvocations.length = 0;
  });

  it("configures the planned concurrency for each worker queue", async () => {
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

    createScriptWorker();
    createStoryboardWorker();
    createImageWorker();
    createVideoWorker();

    expect(workerInvocations).toEqual([
      expect.objectContaining({
        name: "script-queue",
        opts: expect.objectContaining({ concurrency: 5 }),
      }),
      expect.objectContaining({
        name: "storyboard-queue",
        opts: expect.objectContaining({ concurrency: 10 }),
      }),
      expect.objectContaining({
        name: "image-queue",
        opts: expect.objectContaining({ concurrency: 10 }),
      }),
      expect.objectContaining({
        name: "video-queue",
        opts: expect.objectContaining({ concurrency: 5 }),
      }),
    ]);
  });
});
