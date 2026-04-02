import { randomUUID } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { Prisma, TaskStatus, TaskType } from "@prisma/client";
import type { Job, Worker } from "bullmq";
import { Worker as BullmqWorker } from "bullmq";
import { prisma } from "@/lib/db";
import { callProxyModel } from "@/lib/models/proxy-client";
import { getDefaultModelSummary } from "@/lib/models/provider-registry";
import { bullmqConnection } from "@/lib/redis";
import { ServiceError } from "@/lib/services/errors";
import { promoteTempFile, writeTempFile } from "@/lib/storage/fs-storage";
import { getStorageRoot, resolveStoredPath, toStoredPath } from "@/lib/storage/paths";
import { cancelTaskIfRequested } from "@/worker/processors/cancellation";

type VideoPayload = {
  projectId: string;
  prompt: string;
  referenceAssetIds: string[];
  userId: string;
};

type VideoWorkerJobData = {
  taskId: string;
  taskStepId: string;
  traceId: string;
  payload: VideoPayload;
};

type VideoWorkerResult = {
  ok: true;
  traceId: string;
  outputAssetId: string;
  modelProviderKey: string;
  modelName: string;
  referenceAssetIds: string[];
};

const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const ALLOWED_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

function getMaxUploadBytes() {
  const maxUploadMb = Number(process.env.MAX_UPLOAD_MB ?? "25");

  if (!Number.isFinite(maxUploadMb) || maxUploadMb <= 0) {
    return 25 * 1024 * 1024;
  }

  return Math.floor(maxUploadMb * 1024 * 1024);
}

function hasRetriesRemaining(job: Job<VideoWorkerJobData, VideoWorkerResult, string>) {
  const attempts = job.opts.attempts ?? 1;
  const retryCount = job.attemptsMade + 1;

  return retryCount < attempts;
}

function parseVideoPayload(value: unknown): VideoPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Missing video payload");
  }

  const candidate = value as Record<string, unknown>;
  const projectId = typeof candidate.projectId === "string" ? candidate.projectId : "";
  const prompt = typeof candidate.prompt === "string" ? candidate.prompt : "";
  const userId = typeof candidate.userId === "string" ? candidate.userId : "";
  const referenceAssetIds = Array.isArray(candidate.referenceAssetIds)
    ? candidate.referenceAssetIds.filter((value): value is string => typeof value === "string")
    : [];

  if (
    !projectId.trim() ||
    !prompt.trim() ||
    !userId.trim() ||
    referenceAssetIds.length === 0
  ) {
    throw new Error("Video payload is incomplete");
  }

  return {
    projectId: projectId.trim(),
    prompt: prompt.trim(),
    userId: userId.trim(),
    referenceAssetIds: [...new Set(referenceAssetIds.map((value) => value.trim()).filter(Boolean))],
  };
}

async function writeTaskState(
  jobData: VideoWorkerJobData,
  input: {
    status: TaskStatus;
    startedAt?: Date;
    finishedAt?: Date;
    outputJson?: VideoWorkerResult | Prisma.NullTypes.DbNull;
    errorText?: string | null;
    logMessage?: string;
    retryCount?: number;
  },
) {
  const existingTaskStep = await prisma.taskStep.findUnique({
    where: {
      id: jobData.taskStepId,
    },
    select: {
      log: true,
    },
  });
  const nextLog =
    input.logMessage === undefined
      ? undefined
      : [existingTaskStep?.log, `[${new Date().toISOString()}] ${input.logMessage}`]
          .filter((value): value is string => Boolean(value))
          .join("\n");

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
        ...(nextLog === undefined ? {} : { log: nextLog }),
      },
    }),
  ]);
}

function parseDataUrl(value: string) {
  const prefix = "data:";
  if (!value.startsWith(prefix)) {
    throw new Error("Video output must be a data URL");
  }

  const commaIndex = value.indexOf(",");
  if (commaIndex === -1) {
    throw new Error("Invalid video data URL");
  }

  const header = value.slice(prefix.length, commaIndex);
  const data = value.slice(commaIndex + 1);
  const [mimeType, ...params] = header.split(";");
  const isBase64 = params.includes("base64");

  if (!mimeType || !isBase64) {
    throw new Error("Invalid video data URL encoding");
  }

  return {
    mimeType,
    bytes: Buffer.from(data, "base64"),
  };
}

function toDataUrl(mimeType: string, bytes: Buffer) {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function getExtensionForMimeType(mimeType: string) {
  if (mimeType === "video/mp4") {
    return "mp4";
  }

  if (mimeType === "video/webm") {
    return "webm";
  }

  if (mimeType === "video/quicktime") {
    return "mov";
  }

  return "mp4";
}

async function loadReferenceAssets(payload: VideoPayload) {
  const assets = await prisma.asset.findMany({
    where: {
      id: {
        in: payload.referenceAssetIds,
      },
      projectId: payload.projectId,
    },
    select: {
      id: true,
      storagePath: true,
      mimeType: true,
      sizeBytes: true,
    },
  });

  if (assets.length !== payload.referenceAssetIds.length) {
    throw new ServiceError(404, "One or more reference assets were not found");
  }

  const maxBytes = getMaxUploadBytes();
  const storageRoot = getStorageRoot();
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

  return Promise.all(
    payload.referenceAssetIds.map(async (assetId) => {
      const asset = assetsById.get(assetId);

      if (!asset) {
        throw new ServiceError(404, "One or more reference assets were not found");
      }

      if (!ALLOWED_IMAGE_MIME_TYPES.has(asset.mimeType)) {
        throw new ServiceError(409, "Reference assets must be images");
      }

      if (asset.sizeBytes > maxBytes) {
        throw new ServiceError(409, "Reference image exceeds maximum upload size");
      }

      const filePath = resolveStoredPath(storageRoot, asset.storagePath);
      const bytes = await readFile(filePath);

      if (bytes.length > maxBytes) {
        throw new ServiceError(409, "Reference image exceeds maximum upload size");
      }

      return {
        assetId: asset.id,
        mimeType: asset.mimeType,
        bytes,
      };
    }),
  );
}

async function succeedJob(
  jobData: VideoWorkerJobData,
  input: {
    traceId: string;
    outputAssetId: string;
    modelProviderKey: string;
    modelName: string;
    referenceAssetIds: string[];
    retryCount: number;
  },
) {
  const result: VideoWorkerResult = {
    ok: true,
    traceId: input.traceId,
    outputAssetId: input.outputAssetId,
    modelProviderKey: input.modelProviderKey,
    modelName: input.modelName,
    referenceAssetIds: input.referenceAssetIds,
  };

  await writeTaskState(jobData, {
    status: TaskStatus.SUCCEEDED,
    finishedAt: new Date(),
    outputJson: result,
    errorText: null,
    logMessage: `Saved generated video asset ${input.outputAssetId} and completed video generation`,
    retryCount: input.retryCount,
  });

  return result;
}

function createCanceledResult(traceId: string, referenceAssetIds: string[]): VideoWorkerResult {
  return {
    ok: true,
    traceId,
    outputAssetId: "",
    modelProviderKey: "",
    modelName: "",
    referenceAssetIds,
  };
}

export async function processVideoJob(
  job: Job<VideoWorkerJobData, VideoWorkerResult, string>,
): Promise<VideoWorkerResult> {
  const payload = parseVideoPayload(job.data.payload);

  try {
    await writeTaskState(job.data, {
      status: TaskStatus.RUNNING,
      startedAt: new Date(),
      errorText: null,
      logMessage: "Started video generation",
    });

    if (await cancelTaskIfRequested(job.data)) {
      return createCanceledResult(job.data.traceId, payload.referenceAssetIds);
    }

    const modelSummary = await getDefaultModelSummary("video_generate");
    if (!modelSummary?.model) {
      throw new ServiceError(409, "Default model for video_generate is not configured");
    }

    const referenceAssets = await loadReferenceAssets(payload);
    const modelResult = await callProxyModel({
      taskType: "video_generate",
      providerKey: modelSummary.providerKey,
      model: modelSummary.model,
      traceId: job.data.traceId,
      inputFiles: referenceAssets.map((asset) => toDataUrl(asset.mimeType, asset.bytes)),
      inputText: payload.prompt,
      options: {
        projectId: payload.projectId,
        userId: payload.userId,
        referenceAssetIds: payload.referenceAssetIds,
      },
    });

    if (await cancelTaskIfRequested(job.data)) {
      return createCanceledResult(job.data.traceId, payload.referenceAssetIds);
    }

    if (modelResult.status !== "ok") {
      throw new Error(modelResult.errorMessage ?? "Video model request failed");
    }

    const fileOutput = modelResult.fileOutputs?.[0];
    if (!fileOutput || typeof fileOutput !== "string") {
      throw new Error("Video model did not return any video output");
    }

    const parsedOutput = parseDataUrl(fileOutput);
    if (!ALLOWED_VIDEO_MIME_TYPES.has(parsedOutput.mimeType)) {
      throw new Error("Video model returned unsupported mime type");
    }

    const extension = getExtensionForMimeType(parsedOutput.mimeType);
    const storageRoot = getStorageRoot();
    const destinationPath = path.join(
      storageRoot,
      "assets",
      payload.projectId,
      job.data.taskId,
      `${randomUUID()}.${extension}`,
    );

    const tempPath = await writeTempFile(parsedOutput.bytes);
    await promoteTempFile(tempPath, destinationPath);

    const asset = await prisma.asset.create({
      data: {
        projectId: payload.projectId,
        taskId: job.data.taskId,
        kind: "video_generated",
        storagePath: toStoredPath(storageRoot, destinationPath),
        originalName: null,
        mimeType: parsedOutput.mimeType,
        sizeBytes: parsedOutput.bytes.length,
        metadata: {
          prompt: payload.prompt,
          referenceAssetIds: payload.referenceAssetIds,
          traceId: job.data.traceId,
          modelProviderKey: modelSummary.providerKey,
          modelName: modelSummary.model,
          rawResponse: modelResult.rawResponse ?? null,
        } as Prisma.InputJsonValue,
      },
      select: {
        id: true,
      },
    });

    return succeedJob(job.data, {
      traceId: job.data.traceId,
      outputAssetId: asset.id,
      modelProviderKey: modelSummary.providerKey,
      modelName: modelSummary.model,
      referenceAssetIds: payload.referenceAssetIds,
      retryCount: job.attemptsMade,
    });
  } catch (error) {
    const errorText = error instanceof Error ? error.message : "Video job failed";
    const retryCount = job.attemptsMade + 1;
    const status = hasRetriesRemaining(job) ? TaskStatus.QUEUED : TaskStatus.FAILED;

    try {
      await writeTaskState(job.data, {
        status,
        finishedAt: status === TaskStatus.FAILED ? new Date() : undefined,
        outputJson: status === TaskStatus.FAILED ? Prisma.DbNull : undefined,
        errorText,
        logMessage: `Video generation failed: ${errorText}`,
        retryCount,
      });
    } catch {
      // Best-effort compensation while BullMQ manages the failed job state.
    }

    throw error;
  }
}

export function createVideoWorker(): Worker<VideoWorkerJobData, VideoWorkerResult, string> {
  return new BullmqWorker(
    "video-queue",
    async (job) => {
      if (job.name !== TaskType.VIDEO) {
        throw new Error(`Unsupported job "${job.name}" for queue "video-queue"`);
      }

      return processVideoJob(job);
    },
    {
      connection: bullmqConnection,
      concurrency: 5,
    },
  );
}
