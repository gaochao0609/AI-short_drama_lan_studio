import { TaskStatus, type Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const findUniqueOrThrow = vi.fn();
  const count = vi.fn();
  const create = vi.fn();
  const scriptSessionUpdate = vi.fn();
  const taskUpdate = vi.fn();
  const taskStepUpdate = vi.fn();
  const transaction = vi.fn(async (operations: Array<unknown>) => operations);

  return {
    callProxyModel: vi.fn(),
    getDefaultModelSummary: vi.fn(),
    prisma: {
      $transaction: transaction,
      scriptSession: {
        findUniqueOrThrow,
        update: scriptSessionUpdate,
      },
      scriptVersion: {
        count,
        create,
      },
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

vi.mock("@/lib/models/proxy-client", () => ({
  callProxyModel: mocks.callProxyModel,
}));

vi.mock("@/lib/models/provider-registry", () => ({
  getDefaultModelSummary: mocks.getDefaultModelSummary,
}));

import { processScriptFinalizeJob } from "@/worker/processors/script";

describe("processScriptFinalizeJob", () => {
  beforeEach(() => {
    mocks.callProxyModel.mockReset();
    mocks.getDefaultModelSummary.mockReset();
    mocks.prisma.$transaction.mockReset();
    mocks.prisma.scriptSession.findUniqueOrThrow.mockReset();
    mocks.prisma.scriptSession.update.mockReset();
    mocks.prisma.scriptVersion.count.mockReset();
    mocks.prisma.scriptVersion.create.mockReset();
    mocks.prisma.task.update.mockReset();
    mocks.prisma.taskStep.update.mockReset();
  });

  it("writes a script version when a finalize job succeeds", async () => {
    mocks.prisma.scriptSession.findUniqueOrThrow.mockResolvedValue({
      id: "session-1",
      projectId: "project-1",
      creatorId: "user-1",
      idea: "A courier tries to restore stolen memories.",
      qaRecordsJson: [
        {
          round: 1,
          question: "Who is the hero?",
          answer: "A courier.",
        },
      ],
    });
    mocks.prisma.scriptVersion.count.mockResolvedValue(0);
    mocks.getDefaultModelSummary.mockResolvedValue({
      providerKey: "script",
      model: "gpt-4.1-mini",
    });
    mocks.callProxyModel.mockResolvedValue({
      status: "ok",
      textOutput: "INT. ARCHIVE - NIGHT\nThe courier opens the vault.",
      rawResponse: {
        usage: {
          input: 123,
          output: 456,
        },
      },
    });
    mocks.prisma.scriptVersion.create.mockResolvedValue({
      id: "version-1",
    });
    mocks.prisma.scriptSession.update.mockResolvedValue({
      id: "session-1",
      finalScriptVersionId: "version-1",
    });
    mocks.prisma.$transaction.mockResolvedValue([]);

    const job = {
      attemptsMade: 0,
      opts: {
        attempts: 3,
      },
      data: {
        taskId: "task-1",
        taskStepId: "step-1",
        traceId: "trace-1",
        payload: {
          sessionId: "session-1",
          traceId: "trace-1",
        },
      },
    } as Parameters<typeof processScriptFinalizeJob>[0];

    await expect(processScriptFinalizeJob(job)).resolves.toEqual({
      ok: true,
      traceId: "trace-1",
      scriptVersionId: "version-1",
      body: "INT. ARCHIVE - NIGHT\nThe courier opens the vault.",
    });

    expect(mocks.callProxyModel).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: "script_finalize",
        traceId: "trace-1",
      }),
    );
    expect(mocks.prisma.scriptVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: "project-1",
          scriptSessionId: "session-1",
          creatorId: "user-1",
          versionNumber: 1,
          sourceIdea: "A courier tries to restore stolen memories.",
          clarificationQaJson: [
            {
              round: 1,
              question: "Who is the hero?",
              answer: "A courier.",
            },
          ],
          body: "INT. ARCHIVE - NIGHT\nThe courier opens the vault.",
          scriptJson: {
            body: "INT. ARCHIVE - NIGHT\nThe courier opens the vault.",
          } as Prisma.InputJsonValue,
        }),
      }),
    );
    expect(mocks.prisma.scriptSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "session-1",
        },
        data: expect.objectContaining({
          status: "COMPLETED",
          finalScriptVersionId: "version-1",
          completedAt: expect.any(Date),
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
          outputJson: expect.objectContaining({
            ok: true,
            traceId: "trace-1",
            scriptVersionId: "version-1",
            body: "INT. ARCHIVE - NIGHT\nThe courier opens the vault.",
          }),
        }),
      }),
    );
  });
});
