import type { ModelProvider, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  MODEL_TASK_TYPES,
  type ModelTaskType,
  ProviderConfigSchema,
  type ProviderConfig,
} from "@/lib/models/contracts";
import { ServiceError } from "@/lib/services/errors";

const FALLBACK_PROVIDER_KEYS: Record<ModelTaskType, string> = {
  script_question_generate: "script",
  script_finalize: "script",
  storyboard_split: "storyboard",
  image_generate: "image",
  image_edit: "image",
  video_generate: "video",
};

export type ProviderRecord = {
  id: string;
  key: string;
  label: string;
  providerName: string;
  modelName: string | null;
  baseUrl: string | null;
  hasApiKey: boolean;
  timeoutMs: number;
  maxRetries: number;
  enabled: boolean;
  configJson: ProviderConfig;
  createdAt: string;
  updatedAt: string;
};

export type ProviderRuntimeRecord = ProviderRecord & {
  apiKey: string | null;
};

export type DefaultModelSummary = {
  taskType: ModelTaskType;
  providerKey: string;
  label: string;
  providerName: string;
  model: string | null;
};

export function parseProviderConfig(configJson: Prisma.JsonValue | null): ProviderConfig {
  const parsed = ProviderConfigSchema.safeParse(configJson ?? {});

  if (parsed.success) {
    return parsed.data;
  }

  return ProviderConfigSchema.parse({});
}

export function hasExplicitDefaultTasks(config: ProviderConfig) {
  return Object.prototype.hasOwnProperty.call(config, "defaultForTasks");
}

function getExplicitDefaultTasks(config: ProviderConfig) {
  return config.defaultForTasks ?? [];
}

function getFallbackDefaultTasks(providerKey: string) {
  return MODEL_TASK_TYPES.filter((taskType) => FALLBACK_PROVIDER_KEYS[taskType] === providerKey);
}

function canUseFallbackForTask(provider: Pick<ModelProvider, "key" | "configJson">, taskType: ModelTaskType) {
  const config = parseProviderConfig(provider.configJson);

  return !hasExplicitDefaultTasks(config) && FALLBACK_PROVIDER_KEYS[taskType] === provider.key;
}

export function getProviderTaskTypes(provider: Pick<ModelProvider, "key" | "configJson">) {
  const config = parseProviderConfig(provider.configJson);

  if (hasExplicitDefaultTasks(config)) {
    return getExplicitDefaultTasks(config);
  }

  return getFallbackDefaultTasks(provider.key);
}

export function toProviderRecord(provider: ModelProvider): ProviderRecord {
  const config = parseProviderConfig(provider.configJson);
  const effectiveDefaultForTasks = getProviderTaskTypes(provider);

  return {
    id: provider.id,
    key: provider.key,
    label: provider.label,
    providerName: provider.providerName,
    modelName: provider.modelName,
    baseUrl: provider.baseUrl,
    hasApiKey: provider.apiKey !== null,
    timeoutMs: provider.timeoutMs,
    maxRetries: provider.maxRetries,
    enabled: provider.enabled,
    configJson: {
      ...config,
      defaultForTasks: effectiveDefaultForTasks,
    },
    createdAt: provider.createdAt.toISOString(),
    updatedAt: provider.updatedAt.toISOString(),
  };
}

function toProviderRuntimeRecord(provider: ModelProvider): ProviderRuntimeRecord {
  return {
    ...toProviderRecord(provider),
    apiKey: provider.apiKey,
  };
}

export async function listProviderRecords() {
  const providers = await prisma.modelProvider.findMany({
    orderBy: [{ enabled: "desc" }, { updatedAt: "desc" }, { key: "asc" }],
  });

  return providers.map(toProviderRecord);
}

export async function getProviderByKey(key: string, options: { enabledOnly?: boolean } = {}) {
  const provider = await prisma.modelProvider.findUnique({
    where: { key },
  });

  if (!provider) {
    throw new ServiceError(404, `Provider "${key}" not found`);
  }

  if (options.enabledOnly && !provider.enabled) {
    throw new ServiceError(409, `Provider "${key}" is disabled`);
  }

  return toProviderRuntimeRecord(provider);
}

export async function getDefaultModelSummary(taskType: ModelTaskType): Promise<DefaultModelSummary | null> {
  const providers = await prisma.modelProvider.findMany({
    where: {
      enabled: true,
    },
    orderBy: [{ updatedAt: "desc" }, { key: "asc" }],
  });

  const configuredProvider = providers.find((provider) => {
    const config = parseProviderConfig(provider.configJson);

    if (!hasExplicitDefaultTasks(config)) {
      return false;
    }

    return getExplicitDefaultTasks(config).includes(taskType);
  });
  const provider =
    configuredProvider ??
    providers.find((candidate) => canUseFallbackForTask(candidate, taskType)) ??
    null;

  if (!provider) {
    return null;
  }

  return {
    taskType,
    providerKey: provider.key,
    label: provider.label,
    providerName: provider.providerName,
    model: provider.modelName,
  };
}

export async function listDefaultModelSummaries() {
  const summaries = await Promise.all(
    MODEL_TASK_TYPES.map(async (taskType) => [taskType, await getDefaultModelSummary(taskType)] as const),
  );

  return Object.fromEntries(summaries) as Record<ModelTaskType, DefaultModelSummary | null>;
}
