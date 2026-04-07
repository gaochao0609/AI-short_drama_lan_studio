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
    maxUploadMb: 25,
    binding: {
      imageReferenceAssetIds: ["asset-b"],
    },
    defaultReferenceAssets: [
      {
        id: "asset-b",
        originalName: "asset-b.png",
        kind: "image_source",
        mimeType: "image/png",
        sizeBytes: 1234,
        previewDataUrl: "data:image/png;base64,bbbb",
        createdAt: "2026-04-07T09:00:00.000Z",
        taskId: null,
      },
    ],
    referenceAssets: [
      {
        id: "asset-a",
        originalName: "asset-a.png",
        kind: "image_source",
        mimeType: "image/png",
        sizeBytes: 1200,
        previewDataUrl: "data:image/png;base64,aaaa",
        createdAt: "2026-04-07T08:00:00.000Z",
        taskId: null,
      },
      {
        id: "asset-b",
        originalName: "asset-b.png",
        kind: "image_source",
        mimeType: "image/png",
        sizeBytes: 1234,
        previewDataUrl: "data:image/png;base64,bbbb",
        createdAt: "2026-04-07T09:00:00.000Z",
        taskId: null,
      },
    ],
    assets: [
      {
        id: "image-result-1",
        originalName: "image-result-1.png",
        kind: "image_generated",
        mimeType: "image/png",
        sizeBytes: 2234,
        previewDataUrl: "data:image/png;base64,cccc",
        createdAt: "2026-04-07T10:00:00.000Z",
        taskId: "task-99",
      },
    ],
    ...overrides,
  };
}

describe("project images page", () => {
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

      if (url === "/api/images?projectId=project-1") {
        return jsonResponse(createWorkspacePayload());
      }

      if (url === "/api/images" && init?.method === "POST") {
        return jsonResponse({ taskId: "task-1" }, 202);
      }

      if (url === "/api/projects/project-1/workflow-binding" && init?.method === "PATCH") {
        return jsonResponse({
          imageReferenceAssetIds: ["asset-b", "asset-a"],
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
  });

  it("renders default bindings and submits the preselected reference assets", async () => {
    const pageModule = await import("@/app/(workspace)/projects/[projectId]/images/page");

    render(<pageModule.default />);

    expect((await screen.findAllByText("项目制作流程")).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "图片" })).toBeInTheDocument();
    expect(screen.getByText("Project One")).toBeInTheDocument();
    expect(screen.getAllByText("当前默认输入").length).toBeGreaterThan(0);
    expect(screen.getAllByText("asset-b.png").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("图片提示词输入框"), {
      target: { value: "Generate key art." },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成图片" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((entry) => entry[0] === "/api/images");
      const init = call?.[1] as RequestInit | undefined;
      const form = init?.body as FormData;

      expect(form.get("projectId")).toBe("project-1");
      expect(form.get("prompt")).toBe("Generate key art.");
      expect(form.getAll("referenceAssetIds")).toEqual(["asset-b"]);
    });
  });

  it("supports one-off overrides and promoting them to the default binding", async () => {
    const pageModule = await import("@/app/(workspace)/projects/[projectId]/images/page");

    render(<pageModule.default />);

    await screen.findByRole("heading", { name: "Project One" });

    fireEvent.click(screen.getByRole("button", { name: /asset-a\.png/i }));

    expect(await screen.findByText("仅本次使用")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "设为默认输入" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/project-1/workflow-binding",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            imageReferenceAssetIds: ["asset-b", "asset-a"],
          }),
        }),
      );
    });
  });

  it("still submits text-to-image requests when no reference assets are selected", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === "/api/images?projectId=project-1") {
        return jsonResponse(
          createWorkspacePayload({
            binding: {
              imageReferenceAssetIds: [],
            },
            defaultReferenceAssets: [],
          }),
        );
      }

      if (url === "/api/images" && init?.method === "POST") {
        return jsonResponse({ taskId: "task-1" }, 202);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const pageModule = await import("@/app/(workspace)/projects/[projectId]/images/page");

    render(<pageModule.default />);

    await screen.findByRole("heading", { name: "Project One" });

    fireEvent.change(screen.getByLabelText("图片提示词输入框"), {
      target: { value: "Generate key art from text only." },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成图片" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((entry) => entry[0] === "/api/images");
      const init = call?.[1] as RequestInit | undefined;
      const form = init?.body as FormData;

      expect(form.get("prompt")).toBe("Generate key art from text only.");
      expect(form.getAll("referenceAssetIds")).toEqual([]);
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
              outputJson: { ok: true, outputAssetId: "asset-result-2" },
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

      if (url === "/api/images?projectId=project-1") {
        workspaceFetchCount += 1;

        if (workspaceFetchCount >= 2) {
          return jsonResponse({ error: "刷新失败" }, 500);
        }

        return jsonResponse(createWorkspacePayload());
      }

      if (url === "/api/images" && init?.method === "POST") {
        return jsonResponse({ taskId: "task-1" }, 202);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const pageModule = await import("@/app/(workspace)/projects/[projectId]/images/page");

    render(<pageModule.default />);

    await screen.findByRole("heading", { name: "Project One" });

    fireEvent.change(screen.getByLabelText("图片提示词输入框"), {
      target: { value: "Generate key art." },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成图片" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/images",
        expect.objectContaining({ method: "POST" }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/^图片已生成，但刷新结果失败：/)).toBeInTheDocument();
    });
  });
});
