import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn<typeof fetch>(),
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("admin providers page", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("renders unified admin controls and provider status copy", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === "/api/admin/providers" && init?.cache === "no-store") {
        return jsonResponse({
          providers: [
            {
              id: "provider-1",
              key: "openai-main",
              label: "OpenAI Main",
              providerName: "openai",
              modelName: "gpt-5",
              baseUrl: "https://api.openai.com/v1",
              apiKeyMaskedTail: "••••abcd",
              timeoutMs: 30000,
              maxRetries: 2,
              enabled: true,
              configJson: {
                defaultForTasks: ["image_generate"],
              },
              updatedAt: new Date("2026-03-30T10:05:00.000Z").toISOString(),
            },
          ],
          defaultModels: {
            script_question_generate: null,
            script_finalize: null,
            storyboard_split: null,
            image_generate: {
              taskType: "image_generate",
              providerKey: "openai-main",
              label: "OpenAI Main",
              providerName: "openai",
              model: "gpt-5",
            },
            image_edit: null,
            video_generate: null,
          },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const pageModule = await import("@/app/admin/providers/page");

    render(<pageModule.default />);

    await screen.findByRole("heading", { name: "模型提供方" });
    expect(screen.getByRole("button", { name: "创建提供方" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
    expect(screen.getByText("已启用")).toBeInTheDocument();
    expect(screen.getByText("openai-main / gpt-5")).toBeInTheDocument();
  });
});
