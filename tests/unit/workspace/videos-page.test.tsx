import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

async function renderPage() {
  const pageModule = await import(
    "@/app/(workspace)/projects/[projectId]/videos/page"
  );

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
        return jsonResponse({
          project: {
            id: "project-1",
            title: "Project One",
            idea: "Idea",
          },
          referenceAssets: [
            {
              id: "asset-image-1",
              kind: "image_generated",
              mimeType: "image/png",
              sizeBytes: 1234,
              createdAt: "2026-04-03T08:00:00.000Z",
              previewDataUrl: "data:image/png;base64,abcd",
            },
          ],
          videoAssets: [
            {
              id: "asset-video-1",
              kind: "video_generated",
              mimeType: "video/mp4",
              sizeBytes: 2048,
              createdAt: "2026-04-03T09:00:00.000Z",
              previewUrl: "/api/assets/asset-video-1/download",
            },
          ],
          tasks: [],
        });
      }

      if (url === "/api/videos" && init?.method === "POST") {
        return jsonResponse({ taskId: "task-1" }, 202);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
  });

  it("renders the shared workflow header and preserves video task submission", async () => {
    await renderPage();

    expect((await screen.findAllByText("项目制作流程")).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "视频" })).toBeInTheDocument();
    expect(screen.getByText("Project One")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回项目制作台" })).toHaveAttribute(
      "href",
      "/projects/project-1",
    );
    expect(screen.getByText("分镜")).toBeInTheDocument();
    expect(screen.getByText("asset-video-1")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Video prompt input"), {
      target: { value: "Animate the still with a slow push-in." },
    });
    fireEvent.click(screen.getByRole("button", { name: /asset-image-1/i }));
    fireEvent.click(screen.getByText("生成视频"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/videos",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            projectId: "project-1",
            prompt: "Animate the still with a slow push-in.",
            referenceAssetIds: ["asset-image-1"],
          }),
        }),
      );
    });

    expect(await screen.findByText("视频任务已加入队列。")).toBeInTheDocument();
    expect(screen.getByText("任务：task-1")).toBeInTheDocument();
  });
  it("keeps upstream workflow stages waiting when the loaded data does not prove they are complete", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === "/api/videos?projectId=project-1") {
        return jsonResponse({
          project: {
            id: "project-1",
            title: "Project One",
            idea: "Idea",
          },
          referenceAssets: [],
          videoAssets: [],
          tasks: [],
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    await renderPage();
    await screen.findByRole("heading", { name: "Project One" });

    const workflowRail = document.querySelector(".studio-workflow-rail");
    expect(workflowRail).not.toBeNull();

    const workflowCards = Array.from(workflowRail!.querySelectorAll("li"));
    const scriptCard = workflowCards.find((item) => within(item).queryByText("脚本"));
    const storyboardCard = workflowCards.find((item) => within(item).queryByText("分镜"));

    expect(scriptCard).toBeDefined();
    expect(storyboardCard).toBeDefined();
    expect(within(scriptCard!).getByText("待开始")).toHaveClass(
      "studio-status-badge--neutral",
    );
    expect(within(storyboardCard!).getByText("待开始")).toHaveClass(
      "studio-status-badge--neutral",
    );
  });

  it("falls back to the stage title when workspace loading fails", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === "/api/videos?projectId=project-1") {
        return jsonResponse({ error: "加载视频工作区失败" }, 500);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    await renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("加载视频工作区失败");
    await waitFor(() => {
      expect(screen.queryByText("加载项目中...")).not.toBeInTheDocument();
    });
    expect(screen.getAllByRole("heading", { name: "视频" }).length).toBeGreaterThan(1);
  });
});
