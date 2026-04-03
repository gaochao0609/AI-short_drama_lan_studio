import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserMock, redirectMock, RedirectSignal } = vi.hoisted(() => ({
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
}));

vi.mock("@/lib/auth/guards", () => ({
  requireUser: requireUserMock,
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

  it("shows the shared admin chrome and plain-http deployment warning", async () => {
    process.env.APP_URL = "http://192.168.1.20:3000";

    const layoutModule = await import("@/app/admin/layout");

    render(
      await layoutModule.default({
        children: createElement("div", undefined, "admin"),
      }),
    );

    expect(screen.getByText("Lan Studio")).toBeInTheDocument();
    expect(screen.getByText("Admin control")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "User access" })).toHaveAttribute(
      "href",
      "/admin/users",
    );
    expect(screen.getByRole("link", { name: "Provider stack" })).toHaveAttribute(
      "href",
      "/admin/providers",
    );
    expect(screen.getByRole("link", { name: "Task monitor" })).toHaveAttribute(
      "href",
      "/admin/tasks",
    );
    expect(screen.getByRole("link", { name: "Storage vault" })).toHaveAttribute(
      "href",
      "/admin/storage",
    );
    expect(screen.getByText(/API Key/)).toBeInTheDocument();
  });
});
