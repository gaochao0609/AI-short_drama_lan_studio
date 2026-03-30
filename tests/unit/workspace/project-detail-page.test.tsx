import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserMock, getProjectMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  getProjectMock: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireUser: requireUserMock,
}));

vi.mock("@/lib/services/projects", () => ({
  getProject: getProjectMock,
}));

describe("project detail page", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    getProjectMock.mockReset();

    requireUserMock.mockResolvedValue({
      userId: "user-1",
      role: "USER",
      forcePasswordChange: false,
    });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      title: "Project One",
      idea: "A contained script workflow test.",
      status: "ACTIVE",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders project context and workflow links", async () => {
    const pageModule = await import("@/app/(workspace)/projects/[projectId]/page");

    render(
      await pageModule.default({
        params: Promise.resolve({
          projectId: "project-1",
        }),
      }),
    );

    expect(requireUserMock).toHaveBeenCalledTimes(1);
    expect(getProjectMock).toHaveBeenCalledWith("project-1", "user-1");
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
  });
});
