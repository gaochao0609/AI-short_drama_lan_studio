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

  it("renders project artifacts, history, and download entries", async () => {
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
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open script workflow" })).toHaveAttribute(
      "href",
      "/projects/project-1/script",
    );
    expect(screen.getByRole("link", { name: "Back to workspace" })).toHaveAttribute(
      "href",
      "/workspace",
    );
    expect(screen.getByRole("heading", { name: "Script Versions" })).toBeInTheDocument();
    expect(screen.getByText("Version 2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Storyboard Versions" })).toBeInTheDocument();
    expect(screen.getByText("3 frames")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Image Assets" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Video Assets" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Task History" })).toBeInTheDocument();
    expect(screen.getByText("task-video-1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download keyframe.png" })).toHaveAttribute(
      "href",
      "/api/assets/image-1/download",
    );
    expect(screen.getByRole("link", { name: "Download clip.mp4" })).toHaveAttribute(
      "href",
      "/api/assets/video-1/download",
    );
  });
});
