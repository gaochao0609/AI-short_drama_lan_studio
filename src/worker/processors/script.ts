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

export async function processScriptFinalizeJob(
  job: Job<ScriptWorkerJobData, ScriptWorkerResult, string>,
): Promise<ScriptWorkerResult> {
  try {
    await writeTaskState(job.data, {
      status: TaskStatus.RUNNING,
      startedAt: new Date(),
      errorText: null,
    });

    const sessionId = job.data.payload?.sessionId;

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
        qaRecordsJson: true,
      },
    });
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
    const scriptVersion = await prisma.scriptVersion.create({
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

    await prisma.scriptSession.update({
      where: {
        id: session.id,
      },
      data: {
        status: ScriptSessionStatus.COMPLETED,
        finalScriptVersionId: scriptVersion.id,
        completedAt: new Date(),
        currentQuestion: null,
      },
    });

    const result: ScriptWorkerResult = {
      ok: true,
      traceId: job.data.traceId,
      scriptVersionId: scriptVersion.id,
      body,
    };

    await writeTaskState(job.data, {
      status: TaskStatus.SUCCEEDED,
      finishedAt: new Date(),
      outputJson: result,
      errorText: null,
      retryCount: job.attemptsMade,
    });

    return result;
  } catch (error) {
    const errorText =
      error instanceof Error ? error.message : "Script finalize job failed";
    const retryCount = job.attemptsMade + 1;
    const status = hasRetriesRemaining(job)
      ? TaskStatus.QUEUED
      : TaskStatus.FAILED;

    try {
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
