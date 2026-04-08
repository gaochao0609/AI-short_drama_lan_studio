import { AssetCategory, AssetOrigin, TaskStatus, TaskType, type Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const findUniqueOrThrow = vi.fn();
  const scriptSessionUpdateMany = vi.fn();
  const count = vi.fn();
  const create = vi.fn();
  const findFirst = vi.fn();
  const scriptSessionUpdate = vi.fn();
  const taskUpdate = vi.fn();
  const taskFindUnique = vi.fn();
  const taskStepUpdate = vi.fn();
  const projectWorkflowBindingUpdateMany = vi.fn();
  const assetFindMany = vi.fn();
  const assetCreate = vi.fn();
  const assetUpdate = vi.fn();
  const assetDeleteMany = vi.fn();
  const prisma = {
    scriptSession: {
      findUniqueOrThrow,
      updateMany: scriptSessionUpdateMany,
      update: scriptSessionUpdate,
    },
    scriptVersion: {
      count,
      create,
      findFirst,
    },
    task: {
      update: taskUpdate,
      findUnique: taskFindUnique,
    },
    taskStep: {
      update: taskStepUpdate,
    },
    projectWorkflowBinding: {
      updateMany: projectWorkflowBindingUpdateMany,
    },
    asset: {
      findMany: assetFindMany,
      create: assetCreate,
      update: assetUpdate,
      deleteMany: assetDeleteMany,
    },
  };
  const transaction = vi.fn(async (operations: Array<unknown> | ((tx: typeof prisma) => unknown)) =>
    typeof operations === "function" ? operations(prisma) : operations,
  );

  return {
    callProxyModel: vi.fn(),
    getDefaultModelSummary: vi.fn(),
    persistGeneratedScriptAssetFile: vi.fn(),
    prisma: {
      $transaction: transaction,
      ...prisma,
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

vi.mock("@/lib/services/asset-backfill", () => ({
  buildGeneratedScriptAssetMetadata: (input: {
    scriptSessionId: string;
    scriptVersionId: string;
    extractedText: string;
    sourceTask?: {
      taskId?: string | null;
      taskType?: TaskType;
      traceId?: string | null;
    };
  }) => ({
    parseStatus: "ready",
    scriptSessionId: input.scriptSessionId,
    scriptVersionId: input.scriptVersionId,
    extractedText: input.extractedText,
    sourceTask: {
      taskId: input.sourceTask?.taskId ?? null,
      taskType: input.sourceTask?.taskType ?? TaskType.SCRIPT_FINALIZE,
      traceId: input.sourceTask?.traceId ?? null,
    },
  }),
  persistGeneratedScriptAssetFile: mocks.persistGeneratedScriptAssetFile,
}));

import { processScriptFinalizeJob } from "@/worker/processors/script";

describe("processScriptFinalizeJob", () => {
  beforeEach(() => {
    mocks.callProxyModel.mockReset();
    mocks.getDefaultModelSummary.mockReset();
    mocks.prisma.$transaction.mockReset();
    mocks.prisma.scriptSession.findUniqueOrThrow.mockReset();
    mocks.prisma.scriptSession.updateMany.mockReset();
    mocks.prisma.scriptSession.update.mockReset();
    mocks.prisma.scriptVersion.count.mockReset();
    mocks.prisma.scriptVersion.create.mockReset();
    mocks.prisma.scriptVersion.findFirst.mockReset();
    mocks.prisma.task.update.mockReset();
    mocks.prisma.task.findUnique.mockReset();
    mocks.prisma.taskStep.update.mockReset();
    mocks.prisma.projectWorkflowBinding.updateMany.mockReset();
    mocks.prisma.asset.findMany.mockReset();
    mocks.prisma.asset.create.mockReset();
    mocks.prisma.asset.update.mockReset();
    mocks.prisma.asset.deleteMany.mockReset();
    mocks.persistGeneratedScriptAssetFile.mockReset();
    mocks.persistGeneratedScriptAssetFile.mockResolvedValue({
      storagePath: "backfill/scripts/version-1.txt",
      sizeBytes: 49,
    });
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
    mocks.prisma.scriptVersion.findFirst.mockResolvedValue(null);
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
      versionNumber: 1,
    });
    mocks.prisma.scriptSession.updateMany.mockResolvedValue({
      count: 1,
    });
    mocks.prisma.asset.findMany.mockResolvedValue([]);
    mocks.prisma.asset.create.mockResolvedValue({
      id: "asset-1",
    });
    mocks.prisma.$transaction.mockImplementation(async (operations) =>
      typeof operations === "function" ? operations(mocks.prisma) : operations,
    );

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
    expect(mocks.prisma.scriptSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "session-1",
          status: "FINALIZING",
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
    expect(mocks.prisma.asset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: "project-1",
          taskId: "task-1",
          category: AssetCategory.SCRIPT_GENERATED,
          origin: AssetOrigin.SYSTEM,
          metadata: expect.objectContaining({
            parseStatus: "ready",
            scriptSessionId: "session-1",
            scriptVersionId: "version-1",
            extractedText: "INT. ARCHIVE - NIGHT\nThe courier opens the vault.",
            sourceTask: {
              taskId: "task-1",
              taskType: TaskType.SCRIPT_FINALIZE,
              traceId: "trace-1",
            },
          }),
        }),
      }),
    );
    expect(mocks.persistGeneratedScriptAssetFile).toHaveBeenCalledWith({
      scriptVersionId: "version-1",
      extractedText: "INT. ARCHIVE - NIGHT\nThe courier opens the vault.",
    });
  });

  it("updates the existing generated-script asset and removes duplicates on retry", async () => {
    mocks.prisma.scriptSession.findUniqueOrThrow.mockResolvedValue({
      id: "session-1",
      projectId: "project-1",
      creatorId: "user-1",
      idea: "A courier tries to restore stolen memories.",
      status: "FINALIZING",
      qaRecordsJson: [],
      finalScriptVersionId: "version-1",
      finalScriptVersion: {
        id: "version-1",
        versionNumber: 1,
        body: "INT. ARCHIVE - NIGHT\nThe courier opens the vault.",
      },
    });
    mocks.prisma.scriptSession.updateMany.mockResolvedValue({
      count: 1,
    });
    mocks.prisma.asset.findMany.mockResolvedValue([
      {
        id: "asset-1",
      },
      {
        id: "asset-2",
      },
    ]);
    mocks.prisma.asset.update.mockResolvedValue({
      id: "asset-1",
    });
    mocks.prisma.asset.deleteMany.mockResolvedValue({
      count: 1,
    });
    mocks.prisma.projectWorkflowBinding.updateMany.mockResolvedValue({
      count: 1,
    });
    mocks.prisma.$transaction.mockImplementation(async (operations) =>
      typeof operations === "function" ? operations(mocks.prisma) : operations,
    );

    const job = {
      attemptsMade: 1,
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

    expect(mocks.callProxyModel).not.toHaveBeenCalled();
    expect(mocks.prisma.scriptVersion.create).not.toHaveBeenCalled();
    expect(mocks.prisma.asset.create).not.toHaveBeenCalled();
    expect(mocks.prisma.asset.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "asset-1",
        },
        data: expect.objectContaining({
          category: AssetCategory.SCRIPT_GENERATED,
          origin: AssetOrigin.SYSTEM,
          metadata: expect.objectContaining({
            parseStatus: "ready",
            scriptSessionId: "session-1",
            scriptVersionId: "version-1",
            extractedText: "INT. ARCHIVE - NIGHT\nThe courier opens the vault.",
            sourceTask: {
              taskId: "task-1",
              taskType: TaskType.SCRIPT_FINALIZE,
              traceId: "trace-1",
            },
          }),
        }),
      }),
    );
    expect(mocks.prisma.asset.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: {
            in: ["asset-2"],
          },
        },
      }),
    );
    expect(mocks.prisma.projectWorkflowBinding.updateMany).toHaveBeenCalledWith({
      where: {
        projectId: "project-1",
        storyboardScriptAssetId: {
          in: ["asset-2"],
        },
      },
      data: {
        storyboardScriptAssetId: "asset-1",
      },
    });
  });

  it("treats replay after a successful finalize as an idempotent success", async () => {
    mocks.prisma.scriptSession.findUniqueOrThrow.mockResolvedValue({
      id: "session-1",
      projectId: "project-1",
      creatorId: "user-1",
      idea: "A courier tries to restore stolen memories.",
      status: "COMPLETED",
      completedAt: new Date("2026-03-27T12:00:00.000Z"),
      qaRecordsJson: [],
      finalScriptVersionId: "version-1",
      finalScriptVersion: {
        id: "version-1",
        versionNumber: 1,
        body: "INT. ARCHIVE - NIGHT\nThe courier opens the vault.",
      },
    });
    mocks.prisma.asset.findMany.mockResolvedValue([]);
    mocks.prisma.asset.create.mockResolvedValue({
      id: "asset-1",
    });
    mocks.prisma.$transaction.mockImplementation(async (operations) =>
      typeof operations === "function" ? operations(mocks.prisma) : operations,
    );

    const job = {
      attemptsMade: 1,
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

    expect(mocks.callProxyModel).not.toHaveBeenCalled();
    expect(mocks.prisma.scriptVersion.create).not.toHaveBeenCalled();
    expect(mocks.prisma.scriptSession.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.asset.create).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.task.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          id: "task-1",
        },
        data: expect.objectContaining({
          status: TaskStatus.SUCCEEDED,
          outputJson: expect.objectContaining({
            scriptVersionId: "version-1",
          }),
        }),
      }),
    );
  });

  it("reuses a linked script version from a partial previous attempt", async () => {
    mocks.prisma.scriptSession.findUniqueOrThrow.mockResolvedValue({
      id: "session-1",
      projectId: "project-1",
      creatorId: "user-1",
      idea: "A courier tries to restore stolen memories.",
      status: "FINALIZING",
      qaRecordsJson: [],
      finalScriptVersionId: null,
      finalScriptVersion: null,
      completedAt: null,
    });
    mocks.prisma.scriptVersion.findFirst.mockResolvedValue({
      id: "version-2",
      versionNumber: 2,
      body: "INT. HARBOR - DUSK\nThe courier burns the ledger.",
    });
    mocks.prisma.scriptSession.updateMany.mockResolvedValue({
      count: 1,
    });
    mocks.prisma.asset.findMany.mockResolvedValue([]);
    mocks.prisma.asset.create.mockResolvedValue({
      id: "asset-2",
    });
    mocks.prisma.$transaction.mockImplementation(async (operations) =>
      typeof operations === "function" ? operations(mocks.prisma) : operations,
    );

    const job = {
      attemptsMade: 1,
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
      scriptVersionId: "version-2",
      body: "INT. HARBOR - DUSK\nThe courier burns the ledger.",
    });

    expect(mocks.callProxyModel).not.toHaveBeenCalled();
    expect(mocks.prisma.scriptVersion.create).not.toHaveBeenCalled();
    expect(mocks.prisma.asset.create).toHaveBeenCalledTimes(1);
  });

  it("restores the session to ACTIVE when a finalize job fails terminally", async () => {
    mocks.prisma.scriptSession.findUniqueOrThrow.mockResolvedValue({
      id: "session-1",
      projectId: "project-1",
      creatorId: "user-1",
      idea: "A courier tries to restore stolen memories.",
      qaRecordsJson: [],
      finalScriptVersionId: null,
      finalScriptVersion: null,
      completedAt: null,
      status: "FINALIZING",
    });
    mocks.getDefaultModelSummary.mockResolvedValue({
      providerKey: "script",
      model: "gpt-4.1-mini",
    });
    mocks.callProxyModel.mockRejectedValue(new Error("proxy unavailable"));
    mocks.prisma.scriptSession.updateMany.mockResolvedValue({
      count: 1,
    });
    mocks.prisma.$transaction.mockImplementation(async (operations) =>
      typeof operations === "function" ? operations(mocks.prisma) : operations,
    );

    const job = {
      attemptsMade: 2,
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

    await expect(processScriptFinalizeJob(job)).rejects.toThrow("proxy unavailable");

    expect(mocks.prisma.scriptSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "session-1",
        }),
        data: {
          status: "ACTIVE",
        },
      }),
    );
    expect(mocks.prisma.task.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          id: "task-1",
        },
        data: expect.objectContaining({
          status: TaskStatus.FAILED,
          errorText: "proxy unavailable",
        }),
      }),
    );
  });

  it("restores the session to ACTIVE when a finalize job is canceled mid-flight", async () => {
    const cancelRequestedAt = new Date("2026-03-30T12:00:00.000Z");

    mocks.prisma.task.findUnique
      .mockResolvedValueOnce({
        id: "task-1",
        cancelRequestedAt: null,
      })
      .mockResolvedValueOnce({
        id: "task-1",
        cancelRequestedAt,
      });
    mocks.prisma.scriptSession.updateMany.mockResolvedValue({
      count: 1,
    });
    mocks.prisma.scriptSession.findUniqueOrThrow.mockResolvedValue({
      id: "session-1",
      projectId: "project-1",
      creatorId: "user-1",
      idea: "A courier tries to restore stolen memories.",
      status: "FINALIZING",
      qaRecordsJson: [],
      finalScriptVersionId: null,
      finalScriptVersion: null,
      completedAt: null,
    });
    mocks.getDefaultModelSummary.mockResolvedValue({
      providerKey: "script",
      model: "gpt-4.1-mini",
    });
    mocks.callProxyModel.mockResolvedValue({
      status: "ok",
      textOutput: "INT. ARCHIVE - NIGHT\nThe courier opens the vault.",
      rawResponse: {},
    });
    mocks.prisma.$transaction.mockImplementation(async (operations) =>
      typeof operations === "function" ? operations(mocks.prisma) : operations,
    );

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
      scriptVersionId: "",
      body: "",
    });

    expect(mocks.prisma.scriptSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: "session-1",
        status: "FINALIZING",
      },
      data: {
        status: "ACTIVE",
      },
    });
    expect(mocks.prisma.task.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          id: "task-1",
        },
        data: expect.objectContaining({
          status: TaskStatus.CANCELED,
          errorText: "Canceled by admin",
        }),
      }),
    );
  });
});
