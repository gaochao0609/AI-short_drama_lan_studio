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

  it("announces submit failures with alert semantics", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      json: async () => ({
        error: "提交失败",
      }),
    } as Response);

    const pageModule = await import("@/app/(auth)/register-request/page");
    render(createElement(pageModule.default));

    fireEvent.click(screen.getByRole("button", { name: "提交注册申请" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("提交失败");
  });

  it("renders the Lan Studio shell and updated copy", async () => {
    const pageModule = await import("@/app/(auth)/register-request/page");
    render(createElement(pageModule.default));

    expect(screen.getByText("Lan Studio")).toBeVisible();
    expect(
      screen.getByText("提交注册申请后，审批通过即可进入创作工作区。"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "提交注册申请" })).toBeVisible();
  });
});
