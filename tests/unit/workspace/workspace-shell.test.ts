import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireUserMock,
  listRecentProjectsMock,
  listRecentTasksMock,
  countFailedTasksMock,
  redirectMock,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  listRecentProjectsMock: vi.fn(),
  listRecentTasksMock: vi.fn(),
  countFailedTasksMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireUser: requireUserMock,
}));

vi.mock("@/lib/services/projects", () => ({
  listRecentProjects: listRecentProjectsMock,
}));

vi.mock("@/lib/services/tasks", () => ({
  listRecentTasks: listRecentTasksMock,
  countFailedTasks: countFailedTasksMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

describe("workspace shell", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    listRecentProjectsMock.mockReset();
    listRecentTasksMock.mockReset();
    countFailedTasksMock.mockReset();
    redirectMock.mockReset();

    requireUserMock.mockResolvedValue({
      userId: "user-1",
      role: "USER",
      forcePasswordChange: false,
    });
    listRecentProjectsMock.mockResolvedValue([
      {
        id: "project-1",
        title: "Recent Project",
        idea: "Workspace test idea",
        status: "active",
        updatedAt: new Date("2026-03-18T09:00:00.000Z"),
      },
    ]);
    listRecentTasksMock.mockResolvedValue([
      {
        id: "task-1",
        projectId: "project-1",
        type: "IMAGE",
        status: "RUNNING",
        createdAt: new Date("2026-03-18T09:30:00.000Z"),
      },
    ]);
    countFailedTasksMock.mockResolvedValue(2);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the workspace dashboard with recent data", async () => {
    const pageModule = await import("@/app/(workspace)/workspace/page");

    render(await pageModule.default());

    expect(screen.getByRole("heading", { name: "最近项目" })).toBeInTheDocument();
    expect(screen.getByText("Recent Project")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "最近任务" })).toBeInTheDocument();
    expect(screen.getByText("task-1")).toBeInTheDocument();
    expect(screen.getByText("失败任务数")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("redirects unauthenticated users from the workspace layout", async () => {
    requireUserMock.mockRejectedValueOnce(new Error("Unauthorized"));

    const layoutModule = await import("@/app/(workspace)/layout");

    await layoutModule.default({
      children: createElement("div", undefined, "workspace"),
    });

    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("shows only reachable workspace navigation links", async () => {
    const layoutModule = await import("@/app/(workspace)/layout");

    render(
      await layoutModule.default({
        children: createElement("div", undefined, "workspace"),
      }),
    );

    expect(screen.getByRole("link", { name: "仪表盘" })).toHaveAttribute(
      "href",
      "/workspace",
    );
    expect(screen.queryByRole("link", { name: "项目" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "任务" })).not.toBeInTheDocument();
  });
});
