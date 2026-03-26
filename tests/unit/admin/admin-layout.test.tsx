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

  it("shows the non-https deployment warning for plain-http admin installs", async () => {
    process.env.APP_URL = "http://192.168.1.20:3000";

    const layoutModule = await import("@/app/admin/layout");

    render(
      await layoutModule.default({
        children: createElement("div", undefined, "admin"),
      }),
    );

    expect(
      screen.getByText("当前为非 HTTPS 部署，密码和 API Key 传输存在风险"),
    ).toBeInTheDocument();
  });
});
