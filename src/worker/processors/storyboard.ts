import { Prisma, TaskStatus, TaskType } from "@prisma/client";
import type { Job, Worker } from "bullmq";
import { Worker as BullmqWorker } from "bullmq";
import { prisma } from "@/lib/db";
import { callProxyModel } from "@/lib/models/proxy-client";
import { getDefaultModelSummary } from "@/lib/models/provider-registry";
import {
  resolveStoryboardScriptInput,
  StoryboardSegmentsSchema,
  type StoryboardSegment,
} from "@/lib/services/storyboards";
import { ServiceError } from "@/lib/services/errors";
import { bullmqConnection } from "@/lib/redis";
import { cancelTaskIfRequested } from "@/worker/processors/cancellation";

type StoryboardPayload = {
  projectId: string;
  scriptAssetId?: string;
  scriptVersionId?: string;
  userId: string;
};

type StoryboardWorkerJobData = {
  taskId: string;
  taskStepId: string;
  traceId: string;
  payload: StoryboardPayload;
};

type StoryboardWorkerResult = {
  ok: true;
  traceId: string;
  storyboardVersionId: string;
  segments: StoryboardSegment[];
  modelProviderKey: string;
  modelName: string;
};

function hasRetriesRemaining(job: Job<StoryboardWorkerJobData, StoryboardWorkerResult, string>) {
  const attempts = job.opts.attempts ?? 1;
  const retryCount = job.attemptsMade + 1;

  return retryCount < attempts;
}

function parseStoryboardPayload(value: unknown): StoryboardPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Missing storyboard payload");
  }

  const candidate = value as Record<string, unknown>;
  const projectId = typeof candidate.projectId === "string" ? candidate.projectId : "";
  const scriptAssetId =
    typeof candidate.scriptAssetId === "string" ? candidate.scriptAssetId : "";
  const scriptVersionId =
    typeof candidate.scriptVersionId === "string" ? candidate.scriptVersionId : "";
  const userId = typeof candidate.userId === "string" ? candidate.userId : "";

  if (!projectId || (!scriptAssetId && !scriptVersionId) || !userId) {
    throw new Error("Storyboard payload is incomplete");
  }

  return {
    projectId,
    ...(scriptAssetId ? { scriptAssetId } : {}),
    ...(scriptVersionId ? { scriptVersionId } : {}),
    userId,
  };
}

function buildStoryboardPrompt(scriptBody: string) {
  return [
    "Split the full script version into storyboard segments.",
    "Each storyboard segment must represent exactly 15 seconds.",
    "Return only valid JSON as an array of objects.",
    "Each object must include: index, durationSeconds, scene, shot, action, dialogue, videoPrompt.",
    "Keep the segments in story order and keep the video prompts concise but visual.",
    "Script body:",
    scriptBody,
  ].join("\n");
}

async function writeTaskState(
  jobData: StoryboardWorkerJobData,
  input: {
    status: TaskStatus;
    startedAt?: Date;
    finishedAt?: Date;
    outputJson?: StoryboardWorkerResult | Prisma.NullTypes.DbNull;
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

async function succeedJob(
  jobData: StoryboardWorkerJobData,
  input: {
    traceId: string;
    storyboardVersionId: string;
    segments: StoryboardSegment[];
    modelProviderKey: string;
    modelName: string;
    retryCount: number;
  },
) {
  const result: StoryboardWorkerResult = {
    ok: true,
    traceId: input.traceId,
    storyboardVersionId: input.storyboardVersionId,
    segments: input.segments,
    modelProviderKey: input.modelProviderKey,
    modelName: input.modelName,
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

function createCanceledResult(traceId: string): StoryboardWorkerResult {
  return {
    ok: true,
    traceId,
    storyboardVersionId: "",
    segments: [],
    modelProviderKey: "",
    modelName: "",
  };
}

async function getExistingStoryboardVersion(taskId: string) {
  const task = await prisma.task.findUnique({
    where: {
      id: taskId,
    },
    select: {
      storyboardVersion: {
        select: {
          id: true,
          framesJson: true,
          modelProviderKey: true,
          modelName: true,
        },
      },
    },
  });

  if (!task) {
    throw new Error("Storyboard task not found");
  }

  return task.storyboardVersion;
}

async function parseStoryboardSegments(textOutput: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(textOutput);
  } catch {
    throw new Error("Storyboard model did not return valid JSON");
  }

  const result = StoryboardSegmentsSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error("Storyboard model did not return valid storyboard segments");
  }

  return result.data;
}

export async function processStoryboardJob(
  job: Job<StoryboardWorkerJobData, StoryboardWorkerResult, string>,
): Promise<StoryboardWorkerResult> {
  const payload = parseStoryboardPayload(job.data.payload);

  try {
    await writeTaskState(job.data, {
      status: TaskStatus.RUNNING,
      startedAt: new Date(),
      errorText: null,
    });

    if (await cancelTaskIfRequested(job.data)) {
      return createCanceledResult(job.data.traceId);
    }

    const existingStoryboardVersion = await getExistingStoryboardVersion(job.data.taskId);
    if (existingStoryboardVersion) {
      const segments = StoryboardSegmentsSchema.parse(existingStoryboardVersion.framesJson);

      return succeedJob(job.data, {
        traceId: job.data.traceId,
        storyboardVersionId: existingStoryboardVersion.id,
        segments,
        modelProviderKey: existingStoryboardVersion.modelProviderKey ?? "storyboard",
        modelName: existingStoryboardVersion.modelName ?? "unknown",
        retryCount: job.attemptsMade,
      });
    }

    const resolvedScriptInput = await resolveStoryboardScriptInput({
      projectId: payload.projectId,
      scriptAssetId: payload.scriptAssetId,
      scriptVersionId: payload.scriptVersionId,
      userId: payload.userId,
    });

    const modelSummary = await getDefaultModelSummary("storyboard_split");
    if (!modelSummary?.model) {
      throw new ServiceError(
        409,
        "Default model for storyboard_split is not configured",
      );
    }

    const modelResult = await callProxyModel({
      taskType: "storyboard_split",
      providerKey: modelSummary.providerKey,
      model: modelSummary.model,
      traceId: job.data.traceId,
      inputFiles: [],
      inputText: buildStoryboardPrompt(resolvedScriptInput.scriptBody),
      options: {
        projectId: payload.projectId,
        ...(resolvedScriptInput.scriptAssetId
          ? { scriptAssetId: resolvedScriptInput.scriptAssetId }
          : {}),
        ...(resolvedScriptInput.scriptVersionId
          ? { scriptVersionId: resolvedScriptInput.scriptVersionId }
          : {}),
        userId: payload.userId,
      },
    });

    if (await cancelTaskIfRequested(job.data)) {
      return createCanceledResult(job.data.traceId);
    }

    if (modelResult.status !== "ok" || !modelResult.textOutput?.trim()) {
      throw new Error(
        modelResult.errorMessage ?? "Storyboard model did not return storyboard text",
      );
    }

    const segments = await parseStoryboardSegments(modelResult.textOutput.trim());
    let storyboardVersionId = "";

    if (resolvedScriptInput.scriptVersionId) {
      const storyboardVersion = await prisma.storyboardVersion.upsert({
        where: {
          taskId: job.data.taskId,
        },
        create: {
          projectId: payload.projectId,
          scriptVersionId: resolvedScriptInput.scriptVersionId,
          taskId: job.data.taskId,
          framesJson: segments as Prisma.InputJsonValue,
          modelProviderKey: modelSummary.providerKey,
          modelName: modelSummary.model,
          modelMetadataJson: modelResult.rawResponse as Prisma.InputJsonValue,
        },
        update: {
          projectId: payload.projectId,
          scriptVersionId: resolvedScriptInput.scriptVersionId,
          framesJson: segments as Prisma.InputJsonValue,
          modelProviderKey: modelSummary.providerKey,
          modelName: modelSummary.model,
          modelMetadataJson: modelResult.rawResponse as Prisma.InputJsonValue,
        },
        select: {
          id: true,
        },
      });

      storyboardVersionId = storyboardVersion.id;
    }

    return succeedJob(job.data, {
      traceId: job.data.traceId,
      storyboardVersionId,
      segments,
      modelProviderKey: modelSummary.providerKey,
      modelName: modelSummary.model,
      retryCount: job.attemptsMade,
    });
  } catch (error) {
    const errorText =
      error instanceof Error ? error.message : "Storyboard job failed";
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

export function createStoryboardWorker(): Worker<
  StoryboardWorkerJobData,
  StoryboardWorkerResult,
  string
> {
  return new BullmqWorker(
    "storyboard-queue",
    async (job) => {
      if (job.name !== TaskType.STORYBOARD) {
        throw new Error(`Unsupported job "${job.name}" for queue "storyboard-queue"`);
      }

      return processStoryboardJob(job);
    },
    {
      connection: bullmqConnection,
      concurrency: 10,
    },
  );
}
