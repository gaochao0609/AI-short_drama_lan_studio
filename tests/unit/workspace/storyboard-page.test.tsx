import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useParamsMock, useTaskPollingMock, fetchMock, writeTextMock } = vi.hoisted(
  () => ({
    useParamsMock: vi.fn(),
    useTaskPollingMock: vi.fn(),
    fetchMock: vi.fn<typeof fetch>(),
    writeTextMock: vi.fn(),
  }),
);

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
    "@/app/(workspace)/projects/[projectId]/storyboard/page"
  );

  render(<pageModule.default />);
}

describe("project storyboard page", () => {
  beforeEach(() => {
    useParamsMock.mockReset();
    useTaskPollingMock.mockReset();
    fetchMock.mockReset();
    writeTextMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    useParamsMock.mockReturnValue({
      projectId: "project-1",
    });

    useTaskPollingMock.mockImplementation((taskId?: string | null) => ({
      task:
        taskId === "task-1"
          ? {
              id: "task-1",
              status: "SUCCEEDED",
              outputJson: {
                storyboardVersionId: "storyboard-1",
                segments: [
                  {
                    index: 1,
                    durationSeconds: 15,
                    scene: "Archive room",
                    shot: "Wide",
                    action: "The courier studies the vault.",
                    dialogue: "",
                    videoPrompt: "Slow push in on the courier.",
                  },
                ],
              },
            }
          : undefined,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
      isFinished: taskId === "task-1",
    }));
  });

  it("shows default binding state, promotes an override, and posts scriptAssetId for generation", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === "/api/storyboards?projectId=project-1") {
        return jsonResponse({
          project: {
            id: "project-1",
            title: "项目一",
            idea: "追光的信使",
          },
          binding: {
            storyboardScriptAssetId: "script-default",
          },
          defaultScriptAsset: {
            id: "script-default",
            originalName: "默认剧本.txt",
            category: "script_source",
            origin: "upload",
            createdAt: "2026-04-03T08:00:00.000Z",
            extractedText: "默认剧本文本",
            scriptVersionId: null,
          },
          scriptAssets: [
            {
              id: "script-default",
              originalName: "默认剧本.txt",
              category: "script_source",
              origin: "upload",
              createdAt: "2026-04-03T08:00:00.000Z",
              extractedText: "默认剧本文本",
              scriptVersionId: null,
            },
            {
              id: "script-override",
              originalName: "系统定稿.txt",
              category: "script_generated",
              origin: "system",
              createdAt: "2026-04-04T09:30:00.000Z",
              extractedText: "仅本次使用的系统剧本",
              scriptVersionId: "version-2",
            },
          ],
        });
      }

      if (
        url === "/api/projects/project-1/workflow-binding" &&
        init?.method === "PATCH"
      ) {
        return jsonResponse({
          storyboardScriptAssetId: "script-override",
          imageReferenceAssetIds: [],
          videoReferenceAssetIds: [],
        });
      }

      if (url === "/api/storyboards" && init?.method === "POST") {
        return jsonResponse({ taskId: "task-1" }, 202);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    await renderPage();

    expect(
      (await screen.findAllByText("项目制作流程")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "分镜" })).toBeInTheDocument();
    expect(screen.getByText("项目一")).toBeInTheDocument();
    expect(screen.getAllByText("当前默认剧本资产").length).toBeGreaterThan(0);
    expect(screen.getAllByText("默认剧本.txt").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("选择本次分镜剧本"), {
      target: {
        value: "script-override",
      },
    });

    expect(screen.getByText("仅本次使用")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "设为该流程默认输入" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/project-1/workflow-binding",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            storyboardScriptAssetId: "script-override",
          }),
        }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "生成分镜" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/storyboards",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            projectId: "project-1",
            scriptAssetId: "script-override",
          }),
        }),
      );
    });

    expect(await screen.findByText("分镜已生成。")).toBeInTheDocument();
    expect(screen.getByText("Archive room")).toBeInTheDocument();
    expect(screen.getByText("1 段")).toBeInTheDocument();
  });

  it("exposes the empty default-binding state when no storyboard script asset is configured", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === "/api/storyboards?projectId=project-1") {
        return jsonResponse({
          project: {
            id: "project-1",
            title: "项目一",
            idea: "追光的信使",
          },
          binding: {
            storyboardScriptAssetId: null,
          },
          defaultScriptAsset: null,
          scriptAssets: [
            {
              id: "script-upload-1",
              originalName: "上传剧本.txt",
              category: "script_source",
              origin: "upload",
              createdAt: "2026-04-03T08:00:00.000Z",
              extractedText: "上传剧本文本",
              scriptVersionId: null,
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    await renderPage();

    expect(await screen.findByText("当前未设置默认剧本资产")).toBeInTheDocument();
    expect(screen.getByText("上传剧本.txt")).toBeInTheDocument();
    expect(screen.getByText("仅本次使用")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "设为该流程默认输入" }),
    ).toBeInTheDocument();
  });
});
