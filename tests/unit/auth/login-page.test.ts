import { createElement, isValidElement } from "react";
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

describe("login page", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    routerPushMock.mockReset();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
    global.fetch = originalFetch;
  });

  it("routes regular users into the workspace after login", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        userId: "user-1",
        role: "USER",
        forcePasswordChange: false,
      }),
    } as Response);

    const pageModule = await import("@/app/(auth)/login/login-form");
    const { container } = render(createElement(pageModule.default));
    const inputs = container.querySelectorAll("input");

    fireEvent.change(inputs[0]!, {
      target: { value: "writer" },
    });
    fireEvent.change(inputs[1]!, {
      target: { value: "password123" },
    });
    fireEvent.submit(screen.getByRole("button").closest("form")!);

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith("/workspace");
    });
  });

  it("keeps admins landing in the admin area after login", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        userId: "admin-1",
        role: "ADMIN",
        forcePasswordChange: false,
      }),
    } as Response);

    const pageModule = await import("@/app/(auth)/login/login-form");
    const { container } = render(createElement(pageModule.default));
    const inputs = container.querySelectorAll("input");

    fireEvent.change(inputs[0]!, {
      target: { value: "admin" },
    });
    fireEvent.change(inputs[1]!, {
      target: { value: "password123" },
    });
    fireEvent.submit(screen.getByRole("button").closest("form")!);

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith("/admin/users");
    });
  });

  it("uses a sanitized internal next path for admins when one is provided", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        userId: "admin-1",
        role: "ADMIN",
        forcePasswordChange: false,
      }),
    } as Response);

    const pageModule = await import("@/app/(auth)/login/login-form");
    const { container } = render(
      createElement(pageModule.default, { nextPath: "/admin/providers" }),
    );
    const inputs = container.querySelectorAll("input");

    fireEvent.change(inputs[0]!, {
      target: { value: "admin" },
    });
    fireEvent.change(inputs[1]!, {
      target: { value: "password123" },
    });
    fireEvent.submit(screen.getByRole("button").closest("form")!);

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith("/admin/providers");
    });
  });

  it("strips unsafe next values before they reach the login form", async () => {
    const pageModule = await import("@/app/(auth)/login/page");
    const element = await pageModule.default({
      searchParams: Promise.resolve({
        next: "https://evil.example/steal",
      }),
    });

    expect(isValidElement(element)).toBe(true);
    expect(element.props.nextPath).toBeUndefined();
  });

  it("renders the Lan Studio auth shell with updated copy and controls", async () => {
    const pageModule = await import("@/app/(auth)/login/login-form");
    render(createElement(pageModule.default));
    const usernameInput = screen.getByLabelText("用户名");
    const submitButton = screen.getByRole("button", { name: "进入创作工作区" });

    expect(screen.getByText("Lan Studio")).toBeVisible();
    expect(
      screen.getByText("使用工作账号登录，进入创作工作区继续推进短剧生产。"),
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
