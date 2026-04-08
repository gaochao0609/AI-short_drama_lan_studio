import { randomUUID } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { Prisma, TaskStatus, TaskType } from "@prisma/client";
import type { Job, Worker } from "bullmq";
import { Worker as BullmqWorker } from "bullmq";
import { prisma } from "@/lib/db";
import { callProxyModel } from "@/lib/models/proxy-client";
import { getDefaultModelSummary } from "@/lib/models/provider-registry";
import { ServiceError } from "@/lib/services/errors";
import { writeTempFile, promoteTempFile } from "@/lib/storage/fs-storage";
import { getStorageRoot, resolveStoredPath, toStoredPath } from "@/lib/storage/paths";
import { bullmqConnection } from "@/lib/redis";
import { cancelTaskIfRequested } from "@/worker/processors/cancellation";

type ImagePayload = {
  projectId: string;
  prompt: string;
  referenceAssetIds: string[];
  userId: string;
};

type ImageWorkerJobData = {
  taskId: string;
  taskStepId: string;
  traceId: string;
  payload: ImagePayload;
};

type ImageWorkerResult = {
  ok: true;
  traceId: string;
  outputAssetId: string;
  modelProviderKey: string;
  modelName: string;
  referenceAssetIds?: string[];
  sourceAssetId?: string;
};

const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function getMaxUploadBytes() {
  const maxUploadMb = Number(process.env.MAX_UPLOAD_MB ?? "25");

  if (!Number.isFinite(maxUploadMb) || maxUploadMb <= 0) {
    return 25 * 1024 * 1024;
  }

  return Math.floor(maxUploadMb * 1024 * 1024);
}

function hasRetriesRemaining(job: Job<ImageWorkerJobData, ImageWorkerResult, string>) {
  const attempts = job.opts.attempts ?? 1;
  const retryCount = job.attemptsMade + 1;

  return retryCount < attempts;
}

function dedupeOrderedAssetIds(assetIds: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const assetId of assetIds) {
    const normalized = assetId.trim();

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function parseImagePayload(value: unknown): ImagePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Missing image payload");
  }

  const candidate = value as Record<string, unknown>;
  const projectId = typeof candidate.projectId === "string" ? candidate.projectId : "";
  const prompt = typeof candidate.prompt === "string" ? candidate.prompt : "";
  const userId = typeof candidate.userId === "string" ? candidate.userId : "";
  const legacySourceAssetId =
    typeof candidate.sourceAssetId === "string" ? candidate.sourceAssetId : "";
  const referenceAssetIds = Array.isArray(candidate.referenceAssetIds)
    ? candidate.referenceAssetIds.filter((entry): entry is string => typeof entry === "string")
    : [];

  if (!projectId.trim() || !prompt.trim() || !userId.trim()) {
    throw new Error("Image payload is incomplete");
  }

  return {
    projectId: projectId.trim(),
    prompt: prompt.trim(),
    userId: userId.trim(),
    referenceAssetIds: dedupeOrderedAssetIds([
      ...referenceAssetIds,
      ...(legacySourceAssetId.trim() ? [legacySourceAssetId.trim()] : []),
    ]),
  };
}

async function writeTaskState(
  jobData: ImageWorkerJobData,
  input: {
    status: TaskStatus;
    startedAt?: Date;
    finishedAt?: Date;
    outputJson?: ImageWorkerResult | Prisma.NullTypes.DbNull;
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

function parseDataUrl(value: string) {
  const prefix = "data:";
  if (!value.startsWith(prefix)) {
    throw new Error("Image output must be a data URL");
  }

  const commaIndex = value.indexOf(",");
  if (commaIndex === -1) {
    throw new Error("Invalid image data URL");
  }

  const header = value.slice(prefix.length, commaIndex);
  const data = value.slice(commaIndex + 1);

  const [mimeType, ...params] = header.split(";");
  const isBase64 = params.includes("base64");

  if (!mimeType || !isBase64) {
    throw new Error("Invalid image data URL encoding");
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
  if (mimeType === "image/png") {
    return "png";
  }

  if (mimeType === "image/jpeg") {
    return "jpg";
  }

  if (mimeType === "image/webp") {
    return "webp";
  }

  return "png";
}

async function loadReferenceAssetFiles(payload: ImagePayload) {
  if (payload.referenceAssetIds.length === 0) {
    return [];
  }

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
  jobData: ImageWorkerJobData,
  input: {
    traceId: string;
    outputAssetId: string;
    modelProviderKey: string;
    modelName: string;
    referenceAssetIds: string[];
    retryCount: number;
  },
) {
  const result: ImageWorkerResult = {
    ok: true,
    traceId: input.traceId,
    outputAssetId: input.outputAssetId,
    modelProviderKey: input.modelProviderKey,
    modelName: input.modelName,
    ...(input.referenceAssetIds.length > 0
      ? {
          referenceAssetIds: input.referenceAssetIds,
          ...(input.referenceAssetIds.length === 1
            ? { sourceAssetId: input.referenceAssetIds[0] }
            : {}),
        }
      : {}),
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

function createCanceledResult(traceId: string, referenceAssetIds: string[]): ImageWorkerResult {
  return {
    ok: true,
    traceId,
    outputAssetId: "",
    modelProviderKey: "",
    modelName: "",
    ...(referenceAssetIds.length > 0
      ? {
          referenceAssetIds,
          ...(referenceAssetIds.length === 1
            ? { sourceAssetId: referenceAssetIds[0] }
            : {}),
        }
      : {}),
  };
}

export async function processImageJob(
  job: Job<ImageWorkerJobData, ImageWorkerResult, string>,
): Promise<ImageWorkerResult> {
  const payload = parseImagePayload(job.data.payload);
  const modelTaskType = payload.referenceAssetIds.length > 0 ? "image_edit" : "image_generate";

  try {
    await writeTaskState(job.data, {
      status: TaskStatus.RUNNING,
      startedAt: new Date(),
      errorText: null,
    });

    if (await cancelTaskIfRequested(job.data)) {
      return createCanceledResult(job.data.traceId, payload.referenceAssetIds);
    }

    const modelSummary = await getDefaultModelSummary(modelTaskType);
    if (!modelSummary?.model) {
      throw new ServiceError(409, `Default model for ${modelTaskType} is not configured`);
    }

    const referenceAssets = await loadReferenceAssetFiles(payload);
    const modelResult = await callProxyModel({
      taskType: modelTaskType,
      providerKey: modelSummary.providerKey,
      model: modelSummary.model,
      traceId: job.data.traceId,
      inputFiles: referenceAssets.map((asset) => toDataUrl(asset.mimeType, asset.bytes)),
      inputText: payload.prompt,
      options: {
        projectId: payload.projectId,
        userId: payload.userId,
        ...(payload.referenceAssetIds.length > 0
          ? {
              referenceAssetIds: payload.referenceAssetIds,
              ...(payload.referenceAssetIds.length === 1
                ? { sourceAssetId: payload.referenceAssetIds[0] }
                : {}),
            }
          : {}),
      },
    });

    if (await cancelTaskIfRequested(job.data)) {
      return createCanceledResult(job.data.traceId, payload.referenceAssetIds);
    }

    if (modelResult.status !== "ok") {
      throw new Error(modelResult.errorMessage ?? "Image model request failed");
    }

    const fileOutput = modelResult.fileOutputs?.[0];
    if (!fileOutput || typeof fileOutput !== "string") {
      throw new Error("Image model did not return any image output");
    }

    const parsedOutput = parseDataUrl(fileOutput);
    if (!ALLOWED_IMAGE_MIME_TYPES.has(parsedOutput.mimeType)) {
      throw new Error("Image model returned unsupported mime type");
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

    const asset = await prisma.$transaction(async (tx) => {
      const createdAsset = await tx.asset.create({
        data: {
          projectId: payload.projectId,
          taskId: job.data.taskId,
          kind: "image_generated",
          storagePath: toStoredPath(storageRoot, destinationPath),
          originalName: null,
          mimeType: parsedOutput.mimeType,
          sizeBytes: parsedOutput.bytes.length,
          metadata: {
            mode: modelTaskType,
            prompt: payload.prompt,
            referenceAssetIds: payload.referenceAssetIds,
            sourceAssetId: payload.referenceAssetIds[0] ?? null,
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

      if (payload.referenceAssetIds.length > 0) {
        await tx.assetSourceLink.createMany({
          data: payload.referenceAssetIds.map((assetId, index) => ({
            assetId: createdAsset.id,
            sourceAssetId: assetId,
            role: "image_reference",
            orderIndex: index,
          })),
        });
      }

      return createdAsset;
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
    const errorText = error instanceof Error ? error.message : "Image job failed";
    const retryCount = job.attemptsMade + 1;
    const status = hasRetriesRemaining(job) ? TaskStatus.QUEUED : TaskStatus.FAILED;

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

export function createImageWorker(): Worker<ImageWorkerJobData, ImageWorkerResult, string> {
  return new BullmqWorker(
    "image-queue",
    async (job) => {
      if (job.name !== TaskType.IMAGE) {
        throw new Error(`Unsupported job "${job.name}" for queue "image-queue"`);
      }

      return processImageJob(job);
    },
    {
      connection: bullmqConnection,
      concurrency: 10,
    },
  );
}
