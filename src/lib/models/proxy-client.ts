import { type ModelRequest, type ProxyModelResult } from "@/lib/models/contracts";
import { getProviderByKey } from "@/lib/models/provider-registry";
import { ServiceError } from "@/lib/services/errors";

type ProxyPayload = {
  status?: unknown;
  textOutput?: unknown;
  fileOutputs?: unknown;
  errorCode?: unknown;
  errorMessage?: unknown;
};

type UnifiedProxyErrorCode =
  | "PROXY_PROVIDER_NOT_FOUND"
  | "PROXY_PROVIDER_DISABLED"
  | "PROXY_PROVIDER_MISCONFIGURED"
  | "PROXY_AUTH_ERROR"
  | "PROXY_TIMEOUT"
  | "PROXY_RATE_LIMITED"
  | "PROXY_UPSTREAM_ERROR"
  | "PROXY_REQUEST_ERROR"
  | "PROXY_NETWORK_ERROR"
  | "PROXY_RESPONSE_ERROR"
  | "PROXY_RETRY_EXHAUSTED";

function toErrorResult(
  errorCode: UnifiedProxyErrorCode,
  errorMessage: string,
  rawResponse: unknown = null,
): ProxyModelResult {
  return {
    status: "error",
    rawResponse,
    errorCode,
    errorMessage,
  };
}

function mapHttpErrorCode(status: number) {
  if (status === 401 || status === 403) {
    return "PROXY_AUTH_ERROR";
  }

  if (status === 408 || status === 504) {
    return "PROXY_TIMEOUT";
  }

  if (status === 429) {
    return "PROXY_RATE_LIMITED";
  }

  if (status >= 500) {
    return "PROXY_UPSTREAM_ERROR";
  }

  return "PROXY_REQUEST_ERROR";
}

async function readResponseBody(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

function normalizeSuccess(rawResponse: unknown): ProxyModelResult {
  if (typeof rawResponse === "string") {
    return {
      status: "ok",
      textOutput: rawResponse,
      rawResponse,
    };
  }

  if (rawResponse && typeof rawResponse === "object") {
    const payload = rawResponse as ProxyPayload;
    const status = payload.status === "error" ? "error" : "ok";
    const textOutput = typeof payload.textOutput === "string" ? payload.textOutput : undefined;
    const fileOutputs = Array.isArray(payload.fileOutputs)
      ? payload.fileOutputs.filter((value): value is string => typeof value === "string")
      : undefined;

    if (status === "error") {
      return toErrorResult(
        "PROXY_RESPONSE_ERROR",
        typeof payload.errorMessage === "string"
          ? payload.errorMessage
          : "Proxy returned an error payload",
        rawResponse,
      );
    }

    return {
      status,
      textOutput,
      fileOutputs,
      rawResponse,
    };
  }

  return {
    status: "ok",
    rawResponse,
  };
}

function normalizeFailure(rawResponse: unknown, status: number): ProxyModelResult {
  if (rawResponse && typeof rawResponse === "object") {
    const payload = rawResponse as ProxyPayload;

    return toErrorResult(
      mapHttpErrorCode(status),
      typeof payload.errorMessage === "string"
        ? payload.errorMessage
        : `Proxy request failed with status ${status}`,
      rawResponse,
    );
  }

  return toErrorResult(
    mapHttpErrorCode(status),
    typeof rawResponse === "string" && rawResponse.trim().length > 0
      ? rawResponse
      : `Proxy request failed with status ${status}`,
    rawResponse,
  );
}

function normalizeProviderLookupError(error: unknown, providerKey: string): ProxyModelResult {
  if (error instanceof ServiceError) {
    if (error.status === 404) {
      return toErrorResult("PROXY_PROVIDER_NOT_FOUND", error.message);
    }

    return toErrorResult("PROXY_PROVIDER_MISCONFIGURED", error.message);
  }

  return toErrorResult("PROXY_PROVIDER_MISCONFIGURED", `Failed to load provider "${providerKey}"`);
}

export async function callProxyModel(input: ModelRequest): Promise<ProxyModelResult> {
  let provider;

  try {
    provider = await getProviderByKey(input.providerKey);
  } catch (error) {
    return normalizeProviderLookupError(error, input.providerKey);
  }

  if (!provider.enabled) {
    return toErrorResult("PROXY_PROVIDER_DISABLED", `Provider "${provider.key}" is disabled`);
  }

  if (!provider.baseUrl) {
    return toErrorResult(
      "PROXY_PROVIDER_MISCONFIGURED",
      `Provider "${provider.key}" is missing baseUrl`,
    );
  }

  const attemptCount = provider.maxRetries + 1;

  for (let attempt = 0; attempt < attemptCount; attempt += 1) {
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, provider.timeoutMs);

    try {
      const response = await fetch(provider.baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
          "x-provider-key": provider.key,
          "x-trace-id": input.traceId,
        },
        body: JSON.stringify({
          taskType: input.taskType,
          providerKey: provider.key,
          model: input.model,
          inputText: input.inputText,
          inputFiles: input.inputFiles,
          options: input.options,
          traceId: input.traceId,
        }),
        signal: abortController.signal,
      });
      const rawResponse = await readResponseBody(response);

      clearTimeout(timeoutHandle);

      if (!response.ok) {
        if (response.status >= 500 && attempt < attemptCount - 1) {
          continue;
        }

        return normalizeFailure(rawResponse, response.status);
      }

      return normalizeSuccess(rawResponse);
    } catch (error) {
      clearTimeout(timeoutHandle);

      const isAbortError = error instanceof Error && error.name === "AbortError";
      const isLastAttempt = attempt === attemptCount - 1;

      if (!isLastAttempt) {
        continue;
      }

      return toErrorResult(
        isAbortError ? "PROXY_TIMEOUT" : "PROXY_NETWORK_ERROR",
        error instanceof Error ? error.message : "Proxy request failed",
      );
    }
  }

  return toErrorResult("PROXY_RETRY_EXHAUSTED", "Proxy request exhausted all retries");
}
