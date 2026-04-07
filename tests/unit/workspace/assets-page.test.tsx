import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireUserMock,
  listProjectAssetsMock,
  getProjectWorkflowBindingMock,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  listProjectAssetsMock: vi.fn(),
  getProjectWorkflowBindingMock: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireUser: requireUserMock,
}));

vi.mock("@/lib/services/assets", () => ({
  listProjectAssets: listProjectAssetsMock,
}));

vi.mock("@/lib/services/asset-bindings", () => ({
  getProjectWorkflowBinding: getProjectWorkflowBindingMock,
}));

describe("project assets page", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    listProjectAssetsMock.mockReset();
    getProjectWorkflowBindingMock.mockReset();

    requireUserMock.mockResolvedValue({
      userId: "user-1",
      role: "USER",
      forcePasswordChange: false,
    });
    listProjectAssetsMock.mockResolvedValue({
      project: {
        id: "project-1",
        title: "Project One",
      },
      assets: {
        script_source: [
          {
            id: "script-upload-1",
            originalName: "scene-outline.md",
            category: "script_source",
            origin: "upload",
            mimeType: "text/plain",
            parseStatus: "failed",
            parseError: "脚本解析失败：文件编码无法识别",
            createdAt: "2026-04-07T10:00:00.000Z",
            downloadUrl: "/api/assets/script-upload-1/download",
          },
        ],
        script_generated: [],
        image_source: [],
        image_generated: [
          {
            id: "image-generated-1",
            originalName: "hero-frame.png",
            category: "image_generated",
            origin: "system",
            mimeType: "image/png",
            parseStatus: null,
            createdAt: "2026-04-07T10:10:00.000Z",
            downloadUrl: "/api/assets/image-generated-1/download",
          },
        ],
        video_generated: [],
      },
    });
    getProjectWorkflowBindingMock.mockResolvedValue({
      storyboardScriptAssetId: "script-upload-1",
      imageReferenceAssetIds: ["image-generated-1"],
      videoReferenceAssetIds: [],
    });
  });

  it("renders grouped asset cards with upload and management actions", async () => {
    const pageModule = await import("@/app/(workspace)/projects/[projectId]/assets/page");

    render(
      await pageModule.default({
        params: Promise.resolve({
          projectId: "project-1",
        }),
      }),
    );

    expect(requireUserMock).toHaveBeenCalledTimes(1);
    expect(listProjectAssetsMock).toHaveBeenCalledWith("project-1", "user-1");
    expect(getProjectWorkflowBindingMock).toHaveBeenCalledWith("project-1", "user-1");
    expect(screen.getByRole("heading", { name: "资产中心" })).toBeInTheDocument();
    expect(screen.getByText("Project One")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传剧本或图片" })).toBeInTheDocument();
    expect(screen.getByText("当前默认分镜剧本")).toBeInTheDocument();
    expect(screen.getAllByText("scene-outline.md").length).toBeGreaterThan(0);
    expect(screen.getAllByText("hero-frame.png").length).toBeGreaterThan(0);
    expect(screen.getByText("脚本解析失败：文件编码无法识别")).toBeInTheDocument();

    const scriptCard = screen.getByLabelText("script-upload-1 资产卡片");
    expect(within(scriptCard).getByRole("link", { name: "预览" })).toHaveAttribute(
      "href",
      "/api/assets/script-upload-1/download",
    );
    expect(within(scriptCard).getByRole("link", { name: "下载" })).toHaveAttribute(
      "href",
      "/api/assets/script-upload-1/download",
    );
    expect(within(scriptCard).getByRole("button", { name: "绑定到流程" })).toBeInTheDocument();
    expect(within(scriptCard).getByRole("button", { name: "重试解析" })).toBeInTheDocument();
    expect(within(scriptCard).getByRole("button", { name: "删除资产" })).toBeInTheDocument();
    expect(scriptCard).toHaveTextContent("script-upload-1");
  });

  it("renders empty states when no assets or default bindings exist", async () => {
    listProjectAssetsMock.mockResolvedValueOnce({
      project: {
        id: "project-1",
        title: "Project One",
      },
      assets: {
        script_source: [],
        script_generated: [],
        image_source: [],
        image_generated: [],
        video_generated: [],
      },
    });
    getProjectWorkflowBindingMock.mockResolvedValueOnce({
      storyboardScriptAssetId: null,
      imageReferenceAssetIds: [],
      videoReferenceAssetIds: [],
    });

    const pageModule = await import("@/app/(workspace)/projects/[projectId]/assets/page");

    render(
      await pageModule.default({
        params: Promise.resolve({
          projectId: "project-1",
        }),
      }),
    );

    expect(screen.getAllByText("当前项目还没有资产，请先上传剧本或图片。").length).toBeGreaterThan(0);
    expect(
      screen.getByText("当前还没有设置默认绑定，可从资产卡片绑定到分镜、图片或视频流程。"),
    ).toBeInTheDocument();
  });
});
