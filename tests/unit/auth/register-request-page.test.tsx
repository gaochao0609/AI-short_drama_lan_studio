import { createElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("register request page", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
    global.fetch = originalFetch;
  });

  it("submits a request and shows the updated confirmation copy", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    const pageModule = await import("@/app/(auth)/register-request/page");

    render(createElement(pageModule.default));

    fireEvent.change(screen.getByLabelText("用户名"), {
      target: { value: "writer01" },
    });
    fireEvent.change(screen.getByLabelText("显示名称"), {
      target: { value: "Writer 01" },
    });
    fireEvent.change(screen.getByLabelText("申请说明"), {
      target: { value: "申请短剧创作工作区权限" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交注册申请" }));

    await waitFor(() => {
      expect(screen.getByText("申请已提交，请等待管理员审批。")).toBeVisible();
    });
  });

  it("renders the Lan Studio shell and studio-styled form controls", async () => {
    const pageModule = await import("@/app/(auth)/register-request/page");

    render(createElement(pageModule.default));
    const usernameInput = screen.getByLabelText("用户名");
    const submitButton = screen.getByRole("button", { name: "提交注册申请" });

    expect(screen.getByText("Lan Studio")).toBeVisible();
    expect(
      screen.getByText("提交注册申请后，审批通过即可进入创作工作区。"),
    ).toBeVisible();
    expect(usernameInput).toHaveStyle("border-radius: 14px");
    expect(usernameInput.getAttribute("style")).toContain("border: 1px solid rgba(129, 140, 248, 0.24)");
    expect(usernameInput.getAttribute("style")).toContain("background: rgba(15, 15, 35, 0.72)");
    expect(usernameInput).toHaveStyle("color: rgb(248, 250, 252)");
    expect(submitButton.getAttribute("style")).toContain(
      "background: linear-gradient(135deg, rgb(202, 138, 4), rgb(109, 94, 252))",
    );
    expect(submitButton).toHaveStyle("color: rgb(248, 250, 252)");
  });
});
