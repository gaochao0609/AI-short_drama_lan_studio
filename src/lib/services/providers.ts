import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  CreateProviderInputSchema,
  type CreateProviderInput,
  UpdateProviderInputSchema,
  type UpdateProviderInput,
} from "@/lib/models/contracts";
import { toProviderRecord } from "@/lib/models/provider-registry";
import { ServiceError } from "@/lib/services/errors";

type ProviderMutationInput = CreateProviderInput | UpdateProviderInput;

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

export async function listProviders() {
  const providers = await prisma.modelProvider.findMany({
    orderBy: [{ enabled: "desc" }, { updatedAt: "desc" }, { key: "asc" }],
  });

  return providers.map(toProviderRecord);
}

export async function createProvider(rawInput: unknown) {
  const input = CreateProviderInputSchema.parse(rawInput);

  try {
    const provider = await prisma.modelProvider.create({
      data: {
        key: input.key,
        label: input.label,
        providerName: input.providerName,
        modelName: input.modelName,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        timeoutMs: input.timeoutMs,
        maxRetries: input.maxRetries,
        enabled: input.enabled,
        configJson: toConfigJson(input.configJson),
      },
    });

    return toProviderRecord(provider);
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
    data.apiKey = value;
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

  if (input.configJson !== undefined) {
    data.configJson = toConfigJson(input.configJson);
  }

  try {
    const provider = await prisma.modelProvider.update({
      where: { key: input.key },
      data,
    });

    return toProviderRecord(provider);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      throw new ServiceError(404, `Provider "${input.key}" not found`);
    }

    throw error;
  }
}
