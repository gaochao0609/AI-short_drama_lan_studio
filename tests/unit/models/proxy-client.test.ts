import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/lib/services/errors";

const { getProviderByKeyMock, fetchMock } = vi.hoisted(() => ({
  getProviderByKeyMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/models/provider-registry", () => ({
  getProviderByKey: getProviderByKeyMock,
}));

import { callProxyModel } from "@/lib/models/proxy-client";

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
      apiKey: "secret",
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
      apiKey: "secret",
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
      apiKey: "secret",
      timeoutMs: 30000,
      maxRetries: 0,
      enabled: true,
    });
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
  });
});
