import { Prisma, ScriptSessionStatus, TaskStatus, TaskType } from "@prisma/client";
import type { Job, Worker } from "bullmq";
import { Worker as BullmqWorker } from "bullmq";
import { prisma } from "@/lib/db";
import { callProxyModel } from "@/lib/models/proxy-client";
import { getDefaultModelSummary } from "@/lib/models/provider-registry";
import { bullmqConnection } from "@/lib/redis";

type ScriptFinalizePayload = {
  sessionId: string;
  traceId?: string;
};

type ScriptWorkerJobData = {
  taskId: string;
  taskStepId: string;
  traceId: string;
  payload: ScriptFinalizePayload;
};

type ScriptWorkerResult = {
  ok: true;
  traceId: string;
  scriptVersionId: string;
  body: string;
};

type JsonQaCandidate = Record<string, Prisma.JsonValue>;

function hasRetriesRemaining(job: Job<ScriptWorkerJobData, ScriptWorkerResult, string>) {
  const attempts = job.opts.attempts ?? 1;
  const retryCount = job.attemptsMade + 1;

  return retryCount < attempts;
}

function parseQaRecords(value: Prisma.JsonValue | null) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (
      entry,
    ): entry is { round: number; question: string; answer: string } => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return false;
      }

      const candidate = entry as JsonQaCandidate;

      return (
        typeof candidate.round === "number" &&
        typeof candidate.question === "string" &&
        typeof candidate.answer === "string"
      );
    },
  );
}

function buildFinalizePrompt(input: {
  idea: string;
  qaRecords: Array<{ round: number; question: string; answer: string }>;
}) {
  const lines = [
    "Write the final short-drama script based on the creative brief and clarification answers.",
    `Original idea: ${input.idea}`,
  ];

  if (input.qaRecords.length > 0) {
    lines.push("Clarification answers:");
    for (const record of input.qaRecords) {
      lines.push(
        `Round ${record.round} question: ${record.question}`,
        `Round ${record.round} answer: ${record.answer}`,
      );
    }
  }

  lines.push("Return only the completed script body.");

  return lines.join("\n");
}

async function writeTaskState(
  jobData: ScriptWorkerJobData,
  input: {
    status: TaskStatus;
    startedAt?: Date;
    finishedAt?: Date;
    outputJson?: ScriptWorkerResult | Prisma.NullTypes.DbNull;
    errorText?: string | null;
    retryCount?: number;
  },
) {
  await prisma.$transaction([
    prisma.task.update({
      where: {
        id: jobData.taskId,
      },
      data: {
        status: input.status,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        outputJson: input.outputJson,
        errorText: input.errorText,
      },
    }),
    prisma.taskStep.update({
      where: {
        id: jobData.taskStepId,
      },
      data: {
        status: input.status,
        retryCount: input.retryCount,
        outputJson: input.outputJson,
        errorText: input.errorText,
      },
    }),
  ]);
}

async function markSessionCompleted(input: {
  sessionId: string;
  scriptVersionId: string;
  completedAt?: Date | null;
  currentStatus?: ScriptSessionStatus;
  currentFinalScriptVersionId?: string | null;
}) {
  if (
    input.currentStatus === ScriptSessionStatus.COMPLETED &&
    input.currentFinalScriptVersionId === input.scriptVersionId
  ) {
    return;
  }

  const result = await prisma.scriptSession.updateMany({
    where: {
      id: input.sessionId,
      status: ScriptSessionStatus.FINALIZING,
    },
    data: {
      status: ScriptSessionStatus.COMPLETED,
      finalScriptVersionId: input.scriptVersionId,
      completedAt: input.completedAt ?? new Date(),
      currentQuestion: null,
    },
  });

  if (result.count !== 1) {
    throw new Error("Script session changed before finalize could be completed");
  }
}

async function findExistingFinalVersion(input: {
  sessionId: string;
  fallbackFinalVersion?: {
    id: string;
    body: string | null;
  } | null;
}) {
  const fallbackVersion =
    input.fallbackFinalVersion &&
    typeof input.fallbackFinalVersion.body === "string" &&
    input.fallbackFinalVersion.body.trim()
      ? {
          id: input.fallbackFinalVersion.id,
          body: input.fallbackFinalVersion.body.trim(),
        }
      : null;

  if (fallbackVersion) {
    return fallbackVersion;
  }

  const linkedVersion = await prisma.scriptVersion.findFirst({
    where: {
      scriptSessionId: input.sessionId,
    },
    orderBy: {
      versionNumber: "desc",
    },
    select: {
      id: true,
      body: true,
    },
  });

  if (typeof linkedVersion?.body !== "string" || !linkedVersion.body.trim()) {
    return null;
  }

  return {
    id: linkedVersion.id,
    body: linkedVersion.body.trim(),
  };
}

async function succeedJob(
  jobData: ScriptWorkerJobData,
  input: {
    traceId: string;
    scriptVersionId: string;
    body: string;
    retryCount: number;
  },
) {
  const result: ScriptWorkerResult = {
    ok: true,
    traceId: input.traceId,
    scriptVersionId: input.scriptVersionId,
    body: input.body,
  };

  await writeTaskState(jobData, {
    status: TaskStatus.SUCCEEDED,
    finishedAt: new Date(),
    outputJson: result,
    errorText: null,
    retryCount: input.retryCount,
  });

  return result;
}

export async function processScriptFinalizeJob(
  job: Job<ScriptWorkerJobData, ScriptWorkerResult, string>,
): Promise<ScriptWorkerResult> {
  const sessionId = job.data.payload?.sessionId;

  try {
    await writeTaskState(job.data, {
      status: TaskStatus.RUNNING,
      startedAt: new Date(),
      errorText: null,
    });

    if (!sessionId) {
      throw new Error("Missing sessionId for script finalize job");
    }

    const session = await prisma.scriptSession.findUniqueOrThrow({
      where: {
        id: sessionId,
      },
      select: {
        id: true,
        projectId: true,
        creatorId: true,
        idea: true,
        status: true,
        qaRecordsJson: true,
        completedAt: true,
        finalScriptVersionId: true,
        finalScriptVersion: {
          select: {
            id: true,
            body: true,
          },
        },
      },
    });

    const existingFinalVersion = await findExistingFinalVersion({
      sessionId: session.id,
      fallbackFinalVersion: session.finalScriptVersion,
    });

    if (existingFinalVersion) {
      await markSessionCompleted({
        sessionId: session.id,
        scriptVersionId: existingFinalVersion.id,
        completedAt: session.completedAt,
        currentStatus: session.status,
        currentFinalScriptVersionId: session.finalScriptVersionId,
      });

      return succeedJob(job.data, {
        traceId: job.data.traceId,
        scriptVersionId: existingFinalVersion.id,
        body: existingFinalVersion.body,
        retryCount: job.attemptsMade,
      });
    }

    const qaRecords = parseQaRecords(session.qaRecordsJson);
    const modelSummary = await getDefaultModelSummary("script_finalize");

    if (!modelSummary?.model) {
      throw new Error("Default model for script_finalize is not configured");
    }

    const modelResult = await callProxyModel({
      taskType: "script_finalize",
      providerKey: modelSummary.providerKey,
      model: modelSummary.model,
      traceId: job.data.traceId,
      inputFiles: [],
      inputText: buildFinalizePrompt({
        idea: session.idea,
        qaRecords,
      }),
      options: {
        projectId: session.projectId,
        sessionId: session.id,
      },
    });

    if (modelResult.status !== "ok" || !modelResult.textOutput?.trim()) {
      throw new Error(
        modelResult.errorMessage ?? "Script finalize model did not return script text",
      );
    }

    const body = modelResult.textOutput.trim();
    const versionNumber =
      (await prisma.scriptVersion.count({
        where: {
          projectId: session.projectId,
        },
      })) + 1;
    const scriptVersion = await prisma.$transaction(async (tx) => {
      const createdScriptVersion = await tx.scriptVersion.create({
        data: {
          projectId: session.projectId,
          scriptSessionId: session.id,
          creatorId: session.creatorId,
          versionNumber,
          sourceIdea: session.idea,
          clarificationQaJson: qaRecords as Prisma.InputJsonValue,
          body,
          scriptJson: {
            body,
          } as Prisma.InputJsonValue,
          modelProviderKey: modelSummary.providerKey,
          modelName: modelSummary.model,
          modelMetadataJson: modelResult.rawResponse as Prisma.InputJsonValue,
        },
        select: {
          id: true,
        },
      });

      const sessionUpdate = await tx.scriptSession.updateMany({
        where: {
          id: session.id,
          status: ScriptSessionStatus.FINALIZING,
        },
        data: {
          status: ScriptSessionStatus.COMPLETED,
          finalScriptVersionId: createdScriptVersion.id,
          completedAt: new Date(),
          currentQuestion: null,
        },
      });

      if (sessionUpdate.count !== 1) {
        throw new Error("Script session changed before finalize could be completed");
      }

      return createdScriptVersion;
    });

    return succeedJob(job.data, {
      traceId: job.data.traceId,
      scriptVersionId: scriptVersion.id,
      body,
      retryCount: job.attemptsMade,
    });
  } catch (error) {
    const errorText =
      error instanceof Error ? error.message : "Script finalize job failed";
    const retryCount = job.attemptsMade + 1;
    const status = hasRetriesRemaining(job)
      ? TaskStatus.QUEUED
      : TaskStatus.FAILED;

    try {
      if (status === TaskStatus.FAILED && sessionId) {
        await prisma.scriptSession.updateMany({
          where: {
            id: sessionId,
            status: ScriptSessionStatus.FINALIZING,
          },
          data: {
            status: ScriptSessionStatus.ACTIVE,
          },
        });
      }

      await writeTaskState(job.data, {
        status,
        finishedAt: status === TaskStatus.FAILED ? new Date() : undefined,
        outputJson: status === TaskStatus.FAILED ? Prisma.DbNull : undefined,
        errorText,
        retryCount,
      });
    } catch {
      // Best-effort compensation while BullMQ manages the failed job state.
    }

    throw error;
  }
}

export function createScriptWorker(): Worker<
  ScriptWorkerJobData,
  ScriptWorkerResult,
  string
> {
  return new BullmqWorker(
    "script-queue",
    async (job) => {
      if (job.name !== TaskType.SCRIPT_FINALIZE) {
        throw new Error(`Unsupported job "${job.name}" for queue "script-queue"`);
      }

      return processScriptFinalizeJob(job);
    },
    {
      connection: bullmqConnection,
      concurrency: 5,
    },
  );
}
