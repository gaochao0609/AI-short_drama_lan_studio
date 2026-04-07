import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserMock, redirectMock, RedirectSignal, AuthGuardError } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  redirectMock: vi.fn((href: string) => {
    throw new RedirectSignal(href);
  }),
  RedirectSignal: class RedirectSignal extends Error {
    constructor(public readonly href: string) {
      super(`REDIRECT:${href}`);
      this.name = "RedirectSignal";
    }
  },
  AuthGuardError: class AuthGuardError extends Error {
    constructor(
      public readonly status: 401 | 403,
      message: string,
    ) {
      super(message);
      this.name = "AuthGuardError";
    }
  },
}));

vi.mock("@/lib/auth/guards", () => ({
  requireUser: requireUserMock,
  AuthGuardError,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

describe("admin layout", () => {
  const previousAppUrl = process.env.APP_URL;

  beforeEach(() => {
    requireUserMock.mockReset();
    redirectMock.mockReset();
    requireUserMock.mockResolvedValue({
      userId: "admin-1",
      role: "ADMIN",
      forcePasswordChange: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();

    if (previousAppUrl === undefined) {
      delete process.env.APP_URL;
      return;
    }

    process.env.APP_URL = previousAppUrl;
  });

  it("shows the shared admin chrome, nav links, and plain-http warning", async () => {
    process.env.APP_URL = "http://192.168.1.20:3000";

    const layoutModule = await import("@/app/admin/layout");

    const view = render(
      await layoutModule.default({
        children: createElement("div", undefined, "admin"),
      }),
    );

    expect(screen.getByText("Lan Studio")).toBeInTheDocument();
    expect(view.container.querySelector('a[href="/admin/users"]')).not.toBeNull();
    expect(view.container.querySelector('a[href="/admin/providers"]')).not.toBeNull();
    expect(view.container.querySelector('a[href="/admin/tasks"]')).not.toBeNull();
    expect(view.container.querySelector('a[href="/admin/storage"]')).not.toBeNull();
    expect(screen.getByText(/API Key/)).toBeInTheDocument();
  });

  it("redirects unauthenticated users to login", async () => {
    requireUserMock.mockRejectedValueOnce(new AuthGuardError(401, "Unauthorized"));

    const layoutModule = await import("@/app/admin/layout");

    await expect(
      layoutModule.default({
        children: createElement("div", undefined, "admin"),
      }),
    ).rejects.toMatchObject({
      href: "/login",
    });

    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("rethrows unexpected auth-guard failures", async () => {
    const unexpectedError = new Error("database unavailable");
    requireUserMock.mockRejectedValueOnce(unexpectedError);

    const layoutModule = await import("@/app/admin/layout");

    await expect(
      layoutModule.default({
        children: createElement("div", undefined, "admin"),
      }),
    ).rejects.toBe(unexpectedError);

    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects admins who must change their password", async () => {
    requireUserMock.mockResolvedValueOnce({
      userId: "admin-1",
      role: "ADMIN",
      forcePasswordChange: true,
    });

    const layoutModule = await import("@/app/admin/layout");

    await expect(
      layoutModule.default({
        children: createElement("div", undefined, "admin"),
      }),
    ).rejects.toMatchObject({
      href: "/force-password",
    });

    expect(redirectMock).toHaveBeenCalledWith("/force-password");
  });

  it("redirects non-admin users away from the admin shell", async () => {
    requireUserMock.mockResolvedValueOnce({
      userId: "user-1",
      role: "USER",
      forcePasswordChange: false,
    });

    const layoutModule = await import("@/app/admin/layout");

    await expect(
      layoutModule.default({
        children: createElement("div", undefined, "admin"),
      }),
    ).rejects.toMatchObject({
      href: "/",
    });

    expect(redirectMock).toHaveBeenCalledWith("/");
  });
});
