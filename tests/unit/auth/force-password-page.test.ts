import { createElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { routerPushMock } = vi.hoisted(() => ({
  routerPushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

describe("force password page", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    routerPushMock.mockReset();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
    global.fetch = originalFetch;
  });

  it("returns users to the shared homepage redirect after completing the forced password change", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    const pageModule = await import("@/app/(auth)/force-password/page");

    render(createElement(pageModule.default));

    fireEvent.change(screen.getByLabelText("新密码"), {
      target: { value: "BrandNewPassword123!" },
    });
    fireEvent.change(screen.getByLabelText("确认新密码"), {
      target: { value: "BrandNewPassword123!" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "保存并进入工作区" }).closest("form")!);

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith("/");
    });
  });

  it("renders the Lan Studio shell with corrected force-password copy", async () => {
    const pageModule = await import("@/app/(auth)/force-password/page");
    render(createElement(pageModule.default));
    const passwordInput = screen.getByLabelText("新密码");
    const submitButton = screen.getByRole("button", { name: "保存并进入工作区" });

    expect(screen.getByText("Lan Studio")).toBeVisible();
    expect(
      screen.getByText("首次登录需要重设密码，完成后即可进入创作工作区。"),
    ).toBeVisible();
    expect(passwordInput).toHaveStyle("border-radius: 14px");
    expect(passwordInput.getAttribute("style")).toContain("border: 1px solid rgba(129, 140, 248, 0.24)");
    expect(passwordInput.getAttribute("style")).toContain("background: rgba(15, 15, 35, 0.72)");
    expect(passwordInput).toHaveStyle("color: rgb(248, 250, 252)");
    expect(submitButton.getAttribute("style")).toContain(
      "background: linear-gradient(135deg, rgb(202, 138, 4), rgb(109, 94, 252))",
    );
    expect(submitButton).toHaveStyle("color: rgb(248, 250, 252)");
  });
});
