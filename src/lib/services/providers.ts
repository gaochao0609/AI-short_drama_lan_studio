import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  CreateProviderInputSchema,
  type CreateProviderInput,
  type ProviderConfig,
  UpdateProviderInputSchema,
  type UpdateProviderInput,
} from "@/lib/models/contracts";
import { encryptApiKey } from "@/lib/security/secrets";
import {
  getProviderTaskTypes,
  hasExplicitDefaultTasks,
  parseProviderConfig,
  toProviderRecord,
} from "@/lib/models/provider-registry";
import { ServiceError } from "@/lib/services/errors";

type ProviderMutationInput = CreateProviderInput | UpdateProviderInput;
type EncryptedApiKeyUpdate = Pick<
  Prisma.ModelProviderUncheckedCreateInput,
  "apiKeyCiphertext" | "apiKeyIv" | "apiKeyAuthTag" | "apiKeyMaskedTail"
>;

function toConfigJson(value: ProviderMutationInput["configJson"]) {
  return value as Prisma.InputJsonValue;
}

function toOptionalUpdate<T>(
  value: T | undefined,
  assign: (nextValue: T) => void,
) {
  if (value !== undefined) {
    assign(value);
  }
}

function toStoredConfig(config: ProviderConfig) {
  return config as Prisma.InputJsonValue;
}

function toEncryptedApiKeyUpdate(apiKey: string | null): EncryptedApiKeyUpdate {
  if (apiKey === null) {
    return {
      apiKeyCiphertext: null,
      apiKeyIv: null,
      apiKeyAuthTag: null,
      apiKeyMaskedTail: null,
    };
  }

  return encryptApiKey(apiKey);
}

function arrayShallowEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function removeClaimedTaskTypesFromOtherProviders(
  tx: Prisma.TransactionClient,
  ownerKey: string,
  claimedTaskTypes: string[],
) {
  if (claimedTaskTypes.length === 0) {
    return;
  }

  const otherProviders = await tx.modelProvider.findMany({
    where: {
      key: {
        not: ownerKey,
      },
    },
  });

  for (const provider of otherProviders) {
    const effectiveTaskTypes = getProviderTaskTypes(provider);
    const remainingTaskTypes = effectiveTaskTypes.filter((taskType) => !claimedTaskTypes.includes(taskType));

    if (arrayShallowEqual(effectiveTaskTypes, remainingTaskTypes)) {
      continue;
    }

    const currentConfig = parseProviderConfig(provider.configJson);
    const nextConfig: ProviderConfig = {
      ...currentConfig,
      defaultForTasks: remainingTaskTypes,
    };

    await tx.modelProvider.update({
      where: {
        id: provider.id,
      },
      data: {
        configJson: toStoredConfig(nextConfig),
      },
    });
  }
}

export async function listProviders() {
  const providers = await prisma.modelProvider.findMany({
    orderBy: [{ enabled: "desc" }, { updatedAt: "desc" }, { key: "asc" }],
  });

  return providers.map(toProviderRecord);
}

export async function createProvider(rawInput: unknown) {
  const input = CreateProviderInputSchema.parse(rawInput);

  try {
    return await prisma.$transaction(async (tx) => {
      const provider = await tx.modelProvider.create({
        data: {
          key: input.key,
          label: input.label,
          providerName: input.providerName,
          modelName: input.modelName,
          baseUrl: input.baseUrl,
          timeoutMs: input.timeoutMs,
          maxRetries: input.maxRetries,
          enabled: input.enabled,
          configJson: toConfigJson(input.configJson),
          ...toEncryptedApiKeyUpdate(input.apiKey),
        },
      });

      if (hasExplicitDefaultTasks(input.configJson)) {
        await removeClaimedTaskTypesFromOtherProviders(
          tx,
          provider.key,
          input.configJson.defaultForTasks ?? [],
        );
      }

      const refreshedProvider = await tx.modelProvider.findUniqueOrThrow({
        where: {
          id: provider.id,
        },
      });

      return toProviderRecord(refreshedProvider);
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ServiceError(409, `Provider "${input.key}" already exists`);
    }

    throw error;
  }
}

export async function updateProvider(rawInput: unknown) {
  const input = UpdateProviderInputSchema.parse(rawInput);

  return prisma.$transaction(async (tx) => {
    const existingProvider = await tx.modelProvider.findUnique({
      where: {
        key: input.key,
      },
    });

    if (!existingProvider) {
      throw new ServiceError(404, `Provider "${input.key}" not found`);
    }

    const data: Prisma.ModelProviderUpdateInput = {};

    if (input.label !== undefined) {
      data.label = input.label;
    }

    if (input.providerName !== undefined) {
      data.providerName = input.providerName;
    }

    toOptionalUpdate(input.modelName, (value) => {
      data.modelName = value;
    });
    toOptionalUpdate(input.baseUrl, (value) => {
      data.baseUrl = value;
    });
    toOptionalUpdate(input.apiKey, (value) => {
      const encryptedApiKey = toEncryptedApiKeyUpdate(value);

      data.apiKeyCiphertext = encryptedApiKey.apiKeyCiphertext;
      data.apiKeyIv = encryptedApiKey.apiKeyIv;
      data.apiKeyAuthTag = encryptedApiKey.apiKeyAuthTag;
      data.apiKeyMaskedTail = encryptedApiKey.apiKeyMaskedTail;
    });
    toOptionalUpdate(input.timeoutMs, (value) => {
      data.timeoutMs = value;
    });
    toOptionalUpdate(input.maxRetries, (value) => {
      data.maxRetries = value;
    });
    toOptionalUpdate(input.enabled, (value) => {
      data.enabled = value;
    });

    const nextConfig = input.configJson ?? parseProviderConfig(existingProvider.configJson);

    if (input.configJson !== undefined) {
      data.configJson = toConfigJson(input.configJson);
    }

    const provider = await tx.modelProvider.update({
      where: { key: input.key },
      data,
    });

    if (hasExplicitDefaultTasks(nextConfig)) {
      await removeClaimedTaskTypesFromOtherProviders(
        tx,
        provider.key,
        nextConfig.defaultForTasks ?? [],
      );
    }

    const refreshedProvider = await tx.modelProvider.findUniqueOrThrow({
      where: {
        id: provider.id,
      },
    });

    return toProviderRecord(refreshedProvider);
  });
}
