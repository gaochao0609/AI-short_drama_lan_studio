import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useParamsMock, useTaskPollingMock, fetchMock } = vi.hoisted(() => ({
  useParamsMock: vi.fn(),
  useTaskPollingMock: vi.fn(),
  fetchMock: vi.fn<typeof fetch>(),
}));

vi.mock("next/navigation", () => ({
  useParams: useParamsMock,
}));

vi.mock("@/hooks/useTaskPolling", () => ({
  default: useTaskPollingMock,
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function createWorkspacePayload(overrides: Record<string, unknown> = {}) {
  return {
    project: {
      id: "project-1",
      title: "Project One",
      idea: "Idea",
    },
    binding: {
      videoReferenceAssetIds: ["asset-image-2"],
    },
    defaultReferenceAssets: [
      {
        id: "asset-image-2",
        originalName: "asset-image-2.png",
        kind: "image_source",
        mimeType: "image/png",
        sizeBytes: 1234,
        createdAt: "2026-04-07T09:00:00.000Z",
        previewDataUrl: "data:image/png;base64,bbbb",
      },
    ],
    referenceAssets: [
      {
        id: "asset-image-1",
        originalName: "asset-image-1.png",
        kind: "image_source",
        mimeType: "image/png",
        sizeBytes: 1200,
        createdAt: "2026-04-07T08:00:00.000Z",
        previewDataUrl: "data:image/png;base64,aaaa",
      },
      {
        id: "asset-image-2",
        originalName: "asset-image-2.png",
        kind: "image_source",
        mimeType: "image/png",
        sizeBytes: 1234,
        createdAt: "2026-04-07T09:00:00.000Z",
        previewDataUrl: "data:image/png;base64,bbbb",
      },
    ],
    videoAssets: [
      {
        id: "asset-video-1",
        originalName: "asset-video-1.mp4",
        kind: "video_generated",
        mimeType: "video/mp4",
        sizeBytes: 2048,
        createdAt: "2026-04-07T10:00:00.000Z",
        previewUrl: "/api/videos?projectId=project-1&assetId=asset-video-1",
        previewDataUrl: null,
      },
    ],
    tasks: [],
    ...overrides,
  };
}

function createReferenceAssets(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `asset-image-${index + 1}`,
    originalName: `asset-image-${index + 1}.png`,
    kind: "image_source",
    mimeType: "image/png",
    sizeBytes: 1200 + index,
    createdAt: `2026-04-${String((index % 28) + 1).padStart(2, "0")}T08:00:00.000Z`,
    previewDataUrl: `data:image/png;base64,asset-${index + 1}`,
  }));
}

async function renderPage() {
  const pageModule = await import("@/app/(workspace)/projects/[projectId]/videos/page");

  render(<pageModule.default />);
}

describe("project videos page", () => {
  beforeEach(() => {
    useParamsMock.mockReset();
    useTaskPollingMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);

    useParamsMock.mockReturnValue({
      projectId: "project-1",
    });

    useTaskPollingMock.mockReturnValue({
      task: undefined,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
      isFinished: false,
    });

    fetchMock.mockImplementation(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === "/api/videos?projectId=project-1") {
        return jsonResponse(createWorkspacePayload());
      }

      if (url === "/api/videos" && init?.method === "POST") {
        return jsonResponse({ taskId: "task-1" }, 202);
      }

      if (url === "/api/projects/project-1/workflow-binding" && init?.method === "PATCH") {
        return jsonResponse({
          videoReferenceAssetIds: ["asset-image-2", "asset-image-1"],
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
  });

  it("renders default bindings and submits the selected video reference asset ids", async () => {
    await renderPage();

    expect((await screen.findAllByText("项目制作流程")).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "视频" })).toBeInTheDocument();
    expect(screen.getByText("Project One")).toBeInTheDocument();
    expect(screen.getAllByText("当前默认输入").length).toBeGreaterThan(0);
    expect(screen.getByText("asset-video-1")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("视频提示词输入框"), {
      target: { value: "Animate the still with a slow push-in." },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成视频" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/videos",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            projectId: "project-1",
            prompt: "Animate the still with a slow push-in.",
            referenceAssetIds: ["asset-image-2"],
          }),
        }),
      );
    });
  });

  it("supports one-off overrides and promoting them to the default video binding", async () => {
    await renderPage();

    await screen.findByRole("heading", { name: "Project One" });

    fireEvent.click(screen.getByRole("button", { name: /asset-image-1\.png/i }));

    expect(await screen.findByText("仅本次使用")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "设为默认输入" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/project-1/workflow-binding",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            videoReferenceAssetIds: ["asset-image-2", "asset-image-1"],
          }),
        }),
      );
    });
  });

  it("caps one-off and promoted video reference selections at eight ordered assets", async () => {
    const referenceAssets = createReferenceAssets(9);

    fetchMock.mockImplementation(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === "/api/videos?projectId=project-1") {
        return jsonResponse(
          createWorkspacePayload({
            binding: {
              videoReferenceAssetIds: [],
            },
            defaultReferenceAssets: [],
            referenceAssets,
          }),
        );
      }

      if (url === "/api/videos" && init?.method === "POST") {
        return jsonResponse({ taskId: "task-1" }, 202);
      }

      if (url === "/api/projects/project-1/workflow-binding" && init?.method === "PATCH") {
        const payload = JSON.parse(String(init.body ?? "{}")) as { videoReferenceAssetIds?: string[] };
        return jsonResponse({
          videoReferenceAssetIds: payload.videoReferenceAssetIds ?? [],
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    await renderPage();

    await screen.findByRole("heading", { name: "Project One" });

    for (const asset of referenceAssets) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(asset.originalName ?? asset.id, "i") }));
    }

    fireEvent.click(screen.getByRole("button", { name: "设为默认输入" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/project-1/workflow-binding",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            videoReferenceAssetIds: referenceAssets.slice(0, 8).map((asset) => asset.id),
          }),
        }),
      );
    });

    fireEvent.change(screen.getByLabelText("视频提示词输入框"), {
      target: { value: "Animate the still with a slow push-in." },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成视频" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/videos",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            projectId: "project-1",
            prompt: "Animate the still with a slow push-in.",
            referenceAssetIds: referenceAssets.slice(0, 8).map((asset) => asset.id),
          }),
        }),
      );
    });
  });

  it("preserves the generate and refresh flow when a succeeded task cannot refresh the workspace", async () => {
    let workspaceFetchCount = 0;

    useTaskPollingMock.mockImplementation((taskId?: string | null) => ({
      task:
        taskId === "task-1"
          ? {
              id: "task-1",
              status: "SUCCEEDED",
              outputJson: { ok: true, outputAssetId: "asset-video-2" },
            }
          : undefined,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
      isFinished: false,
    }));

    fetchMock.mockImplementation(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === "/api/videos?projectId=project-1") {
        workspaceFetchCount += 1;

        if (workspaceFetchCount >= 2) {
          return jsonResponse({ error: "刷新失败" }, 500);
        }

        return jsonResponse(createWorkspacePayload());
      }

      if (url === "/api/videos" && init?.method === "POST") {
        return jsonResponse({ taskId: "task-1" }, 202);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    await renderPage();

    await screen.findByRole("heading", { name: "Project One" });

    fireEvent.change(screen.getByLabelText("视频提示词输入框"), {
      target: { value: "Animate the still with a slow push-in." },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成视频" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/videos",
        expect.objectContaining({ method: "POST" }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/^视频已生成，但刷新结果失败：/)).toBeInTheDocument();
    });
  });
});
