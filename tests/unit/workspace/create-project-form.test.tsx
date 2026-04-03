import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CreateProjectForm from "@/app/(workspace)/workspace/create-project-form";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: vi.fn(),
  }),
}));

describe("create project form", () => {
  beforeEach(() => {
    pushMock.mockReset();
    vi.restoreAllMocks();
  });

  it("submits the existing project payload and routes to the project detail page", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "project-42",
          title: "控制室样片",
          idea: "追踪一段失控记忆。",
        }),
      } as Response);

    render(<CreateProjectForm />);

    expect(
      screen.getByRole("button", { name: "创建项目并进入脚本流程" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("项目名称"), {
      target: { value: "  控制室样片  " },
    });
    fireEvent.change(screen.getByLabelText("项目概念"), {
      target: { value: "  追踪一段失控记忆。  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建项目并进入脚本流程" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: "控制室样片",
          idea: "追踪一段失控记忆。",
        }),
      });
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/projects/project-42");
    });
  });
});
