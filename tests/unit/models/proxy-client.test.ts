import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/lib/services/errors";

const { getProviderByKeyMock, fetchMock } = vi.hoisted(() => ({
  getProviderByKeyMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/models/provider-registry", () => ({
  getProviderByKey: getProviderByKeyMock,
}));

const { decryptApiKeyMock } = vi.hoisted(() => ({
  decryptApiKeyMock: vi.fn(),
}));

vi.mock("@/lib/security/secrets", () => ({
  decryptApiKey: decryptApiKeyMock,
}));

import { callProxyModel, streamProxyModel } from "@/lib/models/proxy-client";

function buildRequest() {
  return {
    taskType: "script_question_generate" as const,
    providerKey: "script",
    model: "gpt-4.1-mini",
    traceId: "trace-123",
    inputFiles: [],
    options: {},
  };
}

describe("proxy client", () => {
  beforeEach(() => {
    getProviderByKeyMock.mockReset();
    fetchMock.mockReset();
    decryptApiKeyMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a unified error result when the provider lookup fails", async () => {
    getProviderByKeyMock.mockRejectedValue(new ServiceError(404, 'Provider "script" not found'));

    const result = await callProxyModel(buildRequest());

    expect(result).toEqual({
      status: "error",
      rawResponse: null,
      errorCode: "PROXY_PROVIDER_NOT_FOUND",
      errorMessage: 'Provider "script" not found',
    });
  });

  it("returns a unified error result when the provider is misconfigured", async () => {
    getProviderByKeyMock.mockResolvedValue({
      key: "script",
      baseUrl: null,
      apiKeyCiphertext: "cipher",
      apiKeyIv: "iv",
      apiKeyAuthTag: "tag",
      timeoutMs: 30000,
      maxRetries: 2,
      enabled: true,
    });

    const result = await callProxyModel(buildRequest());

    expect(result).toEqual({
      status: "error",
      rawResponse: null,
      errorCode: "PROXY_PROVIDER_MISCONFIGURED",
      errorMessage: 'Provider "script" is missing baseUrl',
    });
  });

  it("returns a unified error result when the provider is disabled", async () => {
    getProviderByKeyMock.mockResolvedValue({
      key: "script",
      baseUrl: "https://proxy.example.com/v1",
      apiKeyCiphertext: "cipher",
      apiKeyIv: "iv",
      apiKeyAuthTag: "tag",
      timeoutMs: 30000,
      maxRetries: 2,
      enabled: false,
    });

    const result = await callProxyModel(buildRequest());

    expect(result).toEqual({
      status: "error",
      rawResponse: null,
      errorCode: "PROXY_PROVIDER_DISABLED",
      errorMessage: 'Provider "script" is disabled',
    });
  });

  it("maps upstream failures to unified error codes instead of passing through raw ones", async () => {
    getProviderByKeyMock.mockResolvedValue({
      key: "script",
      baseUrl: "https://proxy.example.com/v1",
      apiKeyCiphertext: "cipher",
      apiKeyIv: "iv",
      apiKeyAuthTag: "tag",
      timeoutMs: 30000,
      maxRetries: 0,
      enabled: true,
    });
    decryptApiKeyMock.mockReturnValue("secret");
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          errorCode: "vendor_rate_limit",
          errorMessage: "Too many requests",
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );

    const result = await callProxyModel(buildRequest());

    expect(result).toEqual({
      status: "error",
      rawResponse: {
        errorCode: "vendor_rate_limit",
        errorMessage: "Too many requests",
      },
      errorCode: "PROXY_RATE_LIMITED",
      errorMessage: "Too many requests",
    });
    expect(decryptApiKeyMock).toHaveBeenCalledWith({
      apiKeyAuthTag: "tag",
      apiKeyCiphertext: "cipher",
      apiKeyIv: "iv",
    });
  });

  it("streams proxy responses and injects the decrypted authorization header at call time", async () => {
    getProviderByKeyMock.mockResolvedValue({
      key: "script",
      baseUrl: "https://proxy.example.com/v1/stream",
      apiKeyCiphertext: "cipher",
      apiKeyIv: "iv",
      apiKeyAuthTag: "tag",
      timeoutMs: 30000,
      maxRetries: 0,
      enabled: true,
    });
    decryptApiKeyMock.mockReturnValue("stream-secret");
    fetchMock.mockResolvedValue(
      new Response("data: next-question\n\n", {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
        },
      }),
    );

    const stream = await streamProxyModel(buildRequest());

    await expect(new Response(stream).text()).resolves.toBe("data: next-question\n\n");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://proxy.example.com/v1/stream",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer stream-secret",
          "x-provider-key": "script",
          "x-trace-id": "trace-123",
        }),
      }),
    );
  });
});
