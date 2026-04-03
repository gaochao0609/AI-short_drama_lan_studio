import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserMock, getProjectDetailMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  getProjectDetailMock: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireUser: requireUserMock,
}));

vi.mock("@/lib/services/projects", () => ({
  getProjectDetail: getProjectDetailMock,
}));

describe("project detail page", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    getProjectDetailMock.mockReset();

    requireUserMock.mockResolvedValue({
      userId: "user-1",
      role: "USER",
      forcePasswordChange: false,
    });
    getProjectDetailMock.mockResolvedValue({
      id: "project-1",
      title: "Project One",
      idea: "A contained script workflow test.",
      status: "ACTIVE",
      ownerId: "user-1",
      createdAt: "2026-03-30T08:00:00.000Z",
      updatedAt: "2026-03-30T09:00:00.000Z",
      scriptVersions: [
        {
          id: "script-2",
          versionNumber: 2,
          body: "INT. STUDIO - NIGHT",
          createdAt: "2026-03-30T09:00:00.000Z",
        },
      ],
      storyboardVersions: [
        {
          id: "storyboard-1",
          scriptVersionId: "script-2",
          taskId: "task-storyboard-1",
          frameCount: 3,
          createdAt: "2026-03-30T09:05:00.000Z",
        },
      ],
      imageAssets: [
        {
          id: "image-1",
          kind: "image_generated",
          mimeType: "image/png",
          sizeBytes: 1024,
          originalName: "keyframe.png",
          taskId: "task-image-1",
          createdAt: "2026-03-30T09:10:00.000Z",
          downloadUrl: "/api/assets/image-1/download",
          previewDataUrl: "data:image/png;base64,ZmFrZQ==",
        },
      ],
      videoAssets: [
        {
          id: "video-1",
          kind: "video_generated",
          mimeType: "video/mp4",
          sizeBytes: 2048,
          originalName: "clip.mp4",
          taskId: "task-video-1",
          createdAt: "2026-03-30T09:15:00.000Z",
          downloadUrl: "/api/assets/video-1/download",
          previewUrl: "/api/assets/video-1/download",
        },
      ],
      taskHistory: [
        {
          id: "task-video-1",
          type: "VIDEO",
          status: "SUCCEEDED",
          createdAt: "2026-03-30T09:15:00.000Z",
          finishedAt: "2026-03-30T09:20:00.000Z",
          errorText: null,
          outputJson: {
            outputAssetId: "video-1",
          },
        },
      ],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the workflow control page, history, and download entries", async () => {
    const pageModule = await import("@/app/(workspace)/projects/[projectId]/page");

    render(
      await pageModule.default({
        params: Promise.resolve({
          projectId: "project-1",
        }),
      }),
    );

    expect(requireUserMock).toHaveBeenCalledTimes(1);
    expect(getProjectDetailMock).toHaveBeenCalledWith("project-1", "user-1");
    expect(
      screen.getByRole("heading", { name: "Project One" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("A contained script workflow test."),
    ).toBeInTheDocument();
    expect(screen.getByText("制作台")).toBeInTheDocument();
    expect(screen.getByText("进行中")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "继续脚本流程" }),
    ).toHaveAttribute(
      "href",
      "/projects/project-1/script",
    );
    expect(screen.getByRole("link", { name: "返回工作台" })).toHaveAttribute(
      "href",
      "/workspace",
    );
    expect(screen.getByText("Script")).toBeInTheDocument();
    expect(screen.getByText("Images")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "脚本记录" })).toBeInTheDocument();
    expect(screen.getByText("Version 2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "分镜记录" })).toBeInTheDocument();
    expect(screen.getByText("3 个镜头")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "图片资产" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "视频资产" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "任务历史" })).toBeInTheDocument();
    expect(screen.getByText("task-video-1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下载 keyframe.png" })).toHaveAttribute(
      "href",
      "/api/assets/image-1/download",
    );
    expect(screen.getByRole("link", { name: "下载 clip.mp4" })).toHaveAttribute(
      "href",
      "/api/assets/video-1/download",
    );
  });
  it("uses generated images for the workflow rail when newer reference images exist", async () => {
    getProjectDetailMock.mockResolvedValueOnce({
      id: "project-1",
      title: "Project One",
      idea: "A contained script workflow test.",
      status: "ACTIVE",
      ownerId: "user-1",
      createdAt: "2026-03-30T08:00:00.000Z",
      updatedAt: "2026-03-30T09:30:00.000Z",
      scriptVersions: [
        {
          id: "script-2",
          versionNumber: 2,
          body: "INT. STUDIO - NIGHT",
          createdAt: "2026-03-30T09:00:00.000Z",
        },
      ],
      storyboardVersions: [
        {
          id: "storyboard-1",
          scriptVersionId: "script-2",
          taskId: "task-storyboard-1",
          frameCount: 3,
          createdAt: "2026-03-30T09:05:00.000Z",
        },
      ],
      imageAssets: [
        {
          id: "image-ref-1",
          kind: "image_reference",
          mimeType: "image/png",
          sizeBytes: 512,
          originalName: "moodboard.png",
          taskId: null,
          createdAt: "2026-03-30T09:12:00.000Z",
          downloadUrl: "/api/assets/image-ref-1/download",
          previewDataUrl: "data:image/png;base64,cmVm",
        },
        {
          id: "image-1",
          kind: "image_generated",
          mimeType: "image/png",
          sizeBytes: 1024,
          originalName: "keyframe.png",
          taskId: "task-image-1",
          createdAt: "2026-03-30T09:10:00.000Z",
          downloadUrl: "/api/assets/image-1/download",
          previewDataUrl: "data:image/png;base64,ZmFrZQ==",
        },
      ],
      videoAssets: [],
      taskHistory: [
        {
          id: "task-image-1",
          type: "IMAGE",
          status: "SUCCEEDED",
          createdAt: "2026-03-30T09:10:00.000Z",
          finishedAt: "2026-03-30T09:11:00.000Z",
          errorText: null,
          outputJson: {
            outputAssetId: "image-1",
          },
        },
      ],
    });

    const pageModule = await import("@/app/(workspace)/projects/[projectId]/page");

    render(
      await pageModule.default({
        params: Promise.resolve({
          projectId: "project-1",
        }),
      }),
    );

    const workflowRail = screen.getByLabelText("\u6d41\u7a0b\u63a7\u5236");

    expect(workflowRail).toHaveTextContent("keyframe.png");
    expect(workflowRail).not.toHaveTextContent("moodboard.png");
    expect(workflowRail).toHaveTextContent("\u5df2\u4ea7\u51fa");
    expect(workflowRail).toHaveTextContent("\u4e0b\u4e00\u6b65");
    expect(screen.getByText("image-ref-1")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "\u4e0b\u8f7d moodboard.png" }),
    ).toHaveAttribute(
      "href",
      "/api/assets/image-ref-1/download",
    );
  });
});
