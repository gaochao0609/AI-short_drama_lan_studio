import { readFile } from "node:fs/promises";
import path from "node:path";
import { AssetCategory, Prisma, TaskStatus, TaskType } from "@prisma/client";
import type { Job, Worker } from "bullmq";
import { Worker as BullmqWorker } from "bullmq";
import { prisma } from "@/lib/db";
import { bullmqConnection } from "@/lib/redis";
import { getStorageRoot, resolveStoredPath } from "@/lib/storage/paths";
import { cancelTaskIfRequested } from "@/worker/processors/cancellation";

type AssetScriptParsePayload = {
  projectId: string;
  userId?: string;
  assetId: string;
};

type AssetScriptParseWorkerJobData = {
  taskId: string;
  taskStepId: string;
  traceId: string;
  payload: AssetScriptParsePayload;
};

type AssetScriptParseWorkerResult = {
  ok: true;
  traceId: string;
  assetId: string;
  parseStatus: "ready";
};

const SUPPORTED_SCRIPT_EXTENSIONS = new Set([".txt", ".md"]);

function hasRetriesRemaining(
  job: Job<AssetScriptParseWorkerJobData, AssetScriptParseWorkerResult, string>,
) {
  const attempts = job.opts.attempts ?? 1;
  const retryCount = job.attemptsMade + 1;

  return retryCount < attempts;
}

function parsePayload(payload: unknown): AssetScriptParsePayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Missing script parse payload");
  }

  const candidate = payload as Record<string, unknown>;
  const projectId = typeof candidate.projectId === "string" ? candidate.projectId.trim() : "";
  const assetId = typeof candidate.assetId === "string" ? candidate.assetId.trim() : "";
  const userId = typeof candidate.userId === "string" ? candidate.userId.trim() : undefined;

  if (!projectId || !assetId) {
    throw new Error("Script parse payload is incomplete");
  }

  return {
    projectId,
    assetId,
    ...(userId ? { userId } : {}),
  };
}

function readMetadataObject(metadata: Prisma.JsonValue | null) {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return { ...(metadata as Record<string, unknown>) };
  }

  return {};
}

function resolveScriptExtension(input: { originalName: string | null; storagePath: string }) {
  return path.extname(input.originalName ?? input.storagePath).toLowerCase();
}

function normalizeUtf8Text(text: string) {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").normalize("NFC");
}

function toReadyMetadata(input: {
  previousMetadata: Prisma.JsonValue | null;
  extension: string;
  extractedText: string;
}) {
  const metadata = readMetadataObject(input.previousMetadata);
  metadata.extension = input.extension;
  metadata.parseStatus = "ready";
  metadata.extractedText = input.extractedText;
  delete metadata.parseError;
  delete metadata.parseErrorText;

  return metadata as Prisma.InputJsonValue;
}

function toPendingMetadata(input: {
  previousMetadata: Prisma.JsonValue | null;
  extension?: string;
}) {
  const metadata = readMetadataObject(input.previousMetadata);
  if (input.extension) {
    metadata.extension = input.extension;
  }
  metadata.parseStatus = "pending";
  delete metadata.parseError;
  delete metadata.parseErrorText;

  return metadata as Prisma.InputJsonValue;
}

function toFailedMetadata(input: {
  previousMetadata: Prisma.JsonValue | null;
  extension?: string;
  errorText: string;
}) {
  const metadata = readMetadataObject(input.previousMetadata);
  if (input.extension) {
    metadata.extension = input.extension;
  }
  metadata.parseStatus = "failed";
  metadata.parseError = input.errorText;
  metadata.parseErrorText = input.errorText;

  return metadata as Prisma.InputJsonValue;
}

async function writeTaskState(
  jobData: AssetScriptParseWorkerJobData,
  input: {
    status: TaskStatus;
    startedAt?: Date;
    finishedAt?: Date;
    outputJson?: AssetScriptParseWorkerResult | Prisma.NullTypes.DbNull;
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

async function markAssetFailed(input: {
  projectId: string;
  assetId: string;
  errorText: string;
}) {
  const asset = await prisma.asset.findFirst({
    where: {
      id: input.assetId,
      projectId: input.projectId,
    },
    select: {
      id: true,
      originalName: true,
      storagePath: true,
      metadata: true,
    },
  });

  if (!asset) {
    return;
  }

  const extension = resolveScriptExtension({
    originalName: asset.originalName,
    storagePath: asset.storagePath,
  });
  await prisma.asset.update({
    where: {
      id: asset.id,
    },
    data: {
      metadata: toFailedMetadata({
        previousMetadata: asset.metadata,
        extension,
        errorText: input.errorText,
      }),
    },
  });
}

async function markAssetPendingWhileRetrying(input: {
  projectId: string;
  assetId: string;
}) {
  const asset = await prisma.asset.findFirst({
    where: {
      id: input.assetId,
      projectId: input.projectId,
    },
    select: {
      id: true,
      originalName: true,
      storagePath: true,
      metadata: true,
    },
  });

  if (!asset) {
    return;
  }

  const extension = resolveScriptExtension({
    originalName: asset.originalName,
    storagePath: asset.storagePath,
  });
  await prisma.asset.update({
    where: {
      id: asset.id,
    },
    data: {
      metadata: toPendingMetadata({
        previousMetadata: asset.metadata,
        extension,
      }),
    },
  });
}

async function succeedJob(
  jobData: AssetScriptParseWorkerJobData,
  input: {
    traceId: string;
    assetId: string;
    retryCount: number;
  },
) {
  const result: AssetScriptParseWorkerResult = {
    ok: true,
    traceId: input.traceId,
    assetId: input.assetId,
    parseStatus: "ready",
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

function createCanceledResult(traceId: string, assetId: string): AssetScriptParseWorkerResult {
  return {
    ok: true,
    traceId,
    assetId,
    parseStatus: "ready",
  };
}

export async function processAssetScriptParseJob(
  job: Job<AssetScriptParseWorkerJobData, AssetScriptParseWorkerResult, string>,
): Promise<AssetScriptParseWorkerResult> {
  const payload = parsePayload(job.data.payload);

  try {
    await writeTaskState(job.data, {
      status: TaskStatus.RUNNING,
      startedAt: new Date(),
      errorText: null,
    });

    if (await cancelTaskIfRequested(job.data)) {
      return createCanceledResult(job.data.traceId, payload.assetId);
    }

    const asset = await prisma.asset.findFirst({
      where: {
        id: payload.assetId,
        projectId: payload.projectId,
      },
      select: {
        id: true,
        category: true,
        storagePath: true,
        originalName: true,
        metadata: true,
      },
    });

    if (!asset) {
      throw new Error("Script source asset not found");
    }

    if (asset.category && asset.category !== AssetCategory.SCRIPT_SOURCE) {
      throw new Error("Asset is not a script_source asset");
    }

    const extension = resolveScriptExtension({
      originalName: asset.originalName,
      storagePath: asset.storagePath,
    });

    if (!SUPPORTED_SCRIPT_EXTENSIONS.has(extension)) {
      throw new Error(`Unsupported script file extension: ${extension || "(none)"}`);
    }

    const storageRoot = getStorageRoot();
    const filePath = resolveStoredPath(storageRoot, asset.storagePath);
    const bytes = await readFile(filePath);

    let extractedText: string;
    try {
      extractedText = normalizeUtf8Text(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new Error("Malformed UTF-8 script file");
    }

    await prisma.asset.update({
      where: {
        id: asset.id,
      },
      data: {
        metadata: toReadyMetadata({
          previousMetadata: asset.metadata,
          extension,
          extractedText,
        }),
      },
    });

    return succeedJob(job.data, {
      traceId: job.data.traceId,
      assetId: asset.id,
      retryCount: job.attemptsMade,
    });
  } catch (error) {
    const errorText = error instanceof Error ? error.message : "Script parse job failed";
    const retryCount = job.attemptsMade + 1;
    const status = hasRetriesRemaining(job) ? TaskStatus.QUEUED : TaskStatus.FAILED;

    try {
      if (status === TaskStatus.FAILED) {
        await markAssetFailed({
          projectId: payload.projectId,
          assetId: payload.assetId,
          errorText,
        });
      } else {
        await markAssetPendingWhileRetrying({
          projectId: payload.projectId,
          assetId: payload.assetId,
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

export function createAssetScriptParseWorker(): Worker<
  AssetScriptParseWorkerJobData,
  AssetScriptParseWorkerResult,
  string
> {
  return new BullmqWorker(
    "asset-script-parse-queue",
    async (job) => {
      if (job.name !== TaskType.ASSET_SCRIPT_PARSE) {
        throw new Error(
          `Unsupported job "${job.name}" for queue "asset-script-parse-queue"`,
        );
      }

      return processAssetScriptParseJob(job);
    },
    {
      connection: bullmqConnection,
      concurrency: 5,
    },
  );
}
