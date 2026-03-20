import { Prisma, TaskStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const taskUpdate = vi.fn((args: unknown) => args);
  const taskStepUpdate = vi.fn((args: unknown) => args);
  const transaction = vi.fn(async (operations: Array<unknown>) => operations);

  return {
    prisma: {
      $transaction: transaction,
      task: {
        update: taskUpdate,
      },
      taskStep: {
        update: taskStepUpdate,
      },
    },
  };
});

vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

import { runMinimalTask } from "@/worker/processors/shared";

describe("runMinimalTask", () => {
  beforeEach(() => {
    mocks.prisma.$transaction.mockReset();
    mocks.prisma.task.update.mockClear();
    mocks.prisma.taskStep.update.mockClear();
  });

  it("moves the task through running and succeeded states", async () => {
    mocks.prisma.$transaction.mockResolvedValue([]);

    const job = {
      data: {
        taskId: "task-1",
        taskStepId: "step-1",
        traceId: "trace-1",
      },
    } as Parameters<typeof runMinimalTask>[0];

    await expect(runMinimalTask(job)).resolves.toEqual({
      ok: true,
      traceId: "trace-1",
    });

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.task.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          id: "task-1",
        },
        data: expect.objectContaining({
          status: TaskStatus.RUNNING,
          startedAt: expect.any(Date),
        }),
      }),
    );
    expect(mocks.prisma.taskStep.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          id: "step-1",
        },
        data: expect.objectContaining({
          status: TaskStatus.RUNNING,
        }),
      }),
    );
    expect(mocks.prisma.task.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          id: "task-1",
        },
        data: expect.objectContaining({
          status: TaskStatus.SUCCEEDED,
          finishedAt: expect.any(Date),
          outputJson: {
            ok: true,
            traceId: "trace-1",
          },
          errorText: null,
        }),
      }),
    );
    expect(mocks.prisma.taskStep.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          id: "step-1",
        },
        data: expect.objectContaining({
          status: TaskStatus.SUCCEEDED,
          outputJson: {
            ok: true,
            traceId: "trace-1",
          },
          errorText: null,
        }),
      }),
    );
  });

  it("restores queued state when a retryable attempt fails", async () => {
    mocks.prisma.$transaction
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("completion write failed"))
      .mockResolvedValueOnce([]);

    const job = {
      attemptsMade: 0,
      opts: {
        attempts: 3,
      },
      data: {
        taskId: "task-2",
        taskStepId: "step-2",
        traceId: "trace-2",
      },
    } as Parameters<typeof runMinimalTask>[0];

    await expect(runMinimalTask(job)).rejects.toThrow("completion write failed");

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(mocks.prisma.task.update).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: {
          id: "task-2",
        },
        data: expect.objectContaining({
          status: TaskStatus.QUEUED,
          errorText: "completion write failed",
        }),
      }),
    );
    expect(mocks.prisma.taskStep.update).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: {
          id: "step-2",
        },
        data: expect.objectContaining({
          status: TaskStatus.QUEUED,
          retryCount: 1,
          errorText: "completion write failed",
        }),
      }),
    );
  });

  it("clears retry error text when a retry re-enters running", async () => {
    mocks.prisma.$transaction.mockResolvedValue([]);

    const job = {
      attemptsMade: 1,
      opts: {
        attempts: 3,
      },
      data: {
        taskId: "task-2b",
        taskStepId: "step-2b",
        traceId: "trace-2b",
      },
    } as Parameters<typeof runMinimalTask>[0];

    await expect(runMinimalTask(job)).resolves.toEqual({
      ok: true,
      traceId: "trace-2b",
    });

    expect(mocks.prisma.task.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          id: "task-2b",
        },
        data: expect.objectContaining({
          status: TaskStatus.RUNNING,
          errorText: null,
        }),
      }),
    );
    expect(mocks.prisma.taskStep.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          id: "step-2b",
        },
        data: expect.objectContaining({
          status: TaskStatus.RUNNING,
          errorText: null,
        }),
      }),
    );
  });

  it("marks the task failed only after the final retryable attempt is exhausted", async () => {
    mocks.prisma.$transaction
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("completion write failed"))
      .mockResolvedValueOnce([]);

    const job = {
      attemptsMade: 2,
      opts: {
        attempts: 3,
      },
      data: {
        taskId: "task-3",
        taskStepId: "step-3",
        traceId: "trace-3",
      },
    } as Parameters<typeof runMinimalTask>[0];

    await expect(runMinimalTask(job)).rejects.toThrow("completion write failed");

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(mocks.prisma.task.update).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: {
          id: "task-3",
        },
        data: expect.objectContaining({
          status: TaskStatus.FAILED,
          finishedAt: expect.any(Date),
          outputJson: Prisma.DbNull,
          errorText: "completion write failed",
        }),
      }),
    );
    expect(mocks.prisma.taskStep.update).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: {
          id: "step-3",
        },
        data: expect.objectContaining({
          status: TaskStatus.FAILED,
          retryCount: 3,
          outputJson: Prisma.DbNull,
          errorText: "completion write failed",
        }),
      }),
    );
  });
});
