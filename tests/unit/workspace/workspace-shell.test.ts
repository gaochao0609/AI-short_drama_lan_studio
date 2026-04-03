import { createElement } from "react";
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireUserMock,
  listRecentProjectsMock,
  listRecentTasksMock,
  countFailedTasksMock,
  redirectMock,
  AuthGuardErrorMock,
  RedirectSignal,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  listRecentProjectsMock: vi.fn(),
  listRecentTasksMock: vi.fn(),
  countFailedTasksMock: vi.fn(),
  redirectMock: vi.fn((href: string) => {
    throw new RedirectSignal(href);
  }),
  AuthGuardErrorMock: class AuthGuardError extends Error {
    constructor(
      public readonly status: 401 | 403,
      message: string,
    ) {
      super(message);
      this.name = "AuthGuardError";
    }
  },
  RedirectSignal: class RedirectSignal extends Error {
    constructor(public readonly href: string) {
      super(`REDIRECT:${href}`);
      this.name = "RedirectSignal";
    }
  },
}));

vi.mock("@/lib/auth/guards", () => ({
  requireUser: requireUserMock,
  AuthGuardError: AuthGuardErrorMock,
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
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
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
      {
        id: "project-2",
        title: "Quiet Project",
        idea: "No recent tasks in slice",
        status: "active",
        updatedAt: new Date("2026-03-18T08:00:00.000Z"),
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
      {
        id: "task-older",
        projectId: "project-1",
        type: "STORYBOARD",
        status: "SUCCEEDED",
        createdAt: new Date("2026-03-18T09:10:00.000Z"),
      },
    ]);
    countFailedTasksMock.mockResolvedValue(2);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the workspace dashboard and create-project form", async () => {
    const pageModule = await import("@/app/(workspace)/workspace/page");

    render(await pageModule.default());

    expect(screen.getByText("今日创作控制台")).toBeInTheDocument();
    expect(screen.getByText("Recent Project")).toBeInTheDocument();
    expect(screen.getByText("task-1")).toBeInTheDocument();
    expect(screen.getByText("失败任务")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "创建项目并进入脚本流程" }),
    ).toBeInTheDocument();
    const workflowOverview = screen.getByLabelText("Workflow Overview");
    expect(within(workflowOverview).getByText("Script")).toBeInTheDocument();
    expect(within(workflowOverview).getByText("Storyboard")).toBeInTheDocument();
    expect(screen.getByText("当前阶段：Images")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "进入视频流程：Recent Project" }),
    ).toHaveAttribute("href", "/projects/project-1/videos");
    expect(screen.getByText("当前阶段：暂无最近任务")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "查看项目详情：Quiet Project" }),
    ).toHaveAttribute("href", "/projects/project-2");
  });

  it("redirects unauthenticated users from the workspace layout", async () => {
    requireUserMock.mockRejectedValueOnce(
      new AuthGuardErrorMock(401, "Unauthorized"),
    );

    const layoutModule = await import("@/app/(workspace)/layout");

    await expect(
      layoutModule.default({
        children: createElement("div", undefined, "workspace"),
      }),
    ).rejects.toMatchObject({
      href: "/login",
    });

    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("rethrows non-auth errors from requireUser", async () => {
    requireUserMock.mockRejectedValueOnce(new Error("database unavailable"));

    const layoutModule = await import("@/app/(workspace)/layout");

    await expect(
      layoutModule.default({
        children: createElement("div", undefined, "workspace"),
      }),
    ).rejects.toThrow("database unavailable");

    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects users who must change their password", async () => {
    requireUserMock.mockResolvedValueOnce({
      userId: "user-1",
      role: "USER",
      forcePasswordChange: true,
    });

    const layoutModule = await import("@/app/(workspace)/layout");

    await expect(
      layoutModule.default({
        children: createElement("div", undefined, "workspace"),
      }),
    ).rejects.toMatchObject({
      href: "/force-password",
    });

    expect(redirectMock).toHaveBeenCalledWith("/force-password");
  });

  it("shows only reachable workspace navigation links", async () => {
    const layoutModule = await import("@/app/(workspace)/layout");

    render(
      await layoutModule.default({
        children: createElement("div", undefined, "workspace"),
      }),
    );

    expect(screen.getByText("Lan Studio")).toBeInTheDocument();
    expect(screen.getByText("Creative workspace")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Workspace overview" })).toHaveAttribute(
      "href",
      "/workspace",
    );
    expect(screen.getByText("Script")).toBeInTheDocument();
    expect(screen.getByText("Storyboard")).toBeInTheDocument();
    expect(screen.getByText("Images")).toBeInTheDocument();
    expect(screen.getByText("Videos")).toBeInTheDocument();
  });
});
