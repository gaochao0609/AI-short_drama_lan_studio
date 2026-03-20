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

    render(createElement(pageModule.default));

    fireEvent.change(screen.getByLabelText("用户名"), {
      target: { value: "writer" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "password123" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "登录" }).closest("form")!);

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

    render(createElement(pageModule.default));

    fireEvent.change(screen.getByLabelText("用户名"), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "password123" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "登录" }).closest("form")!);

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith("/admin/users");
    });
  });
});
