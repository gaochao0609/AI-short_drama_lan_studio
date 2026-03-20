import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserMock, redirectMock, AuthGuardErrorMock, RedirectSignal } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  redirectMock: vi.fn((href: string) => {
    throw new RedirectSignal(href);
  }),
  AuthGuardErrorMock: class AuthGuardError extends Error {
    constructor(
      public readonly status: 401 | 403,
      message: string,
    ) {
      super(message);
      this.name = "AuthGuardError";
    }
  },
  RedirectSignal: class RedirectSignal extends Error {
    constructor(public readonly href: string) {
      super(`REDIRECT:${href}`);
      this.name = "RedirectSignal";
    }
  },
}));

vi.mock("@/lib/auth/guards", () => ({
  requireUser: requireUserMock,
  AuthGuardError: AuthGuardErrorMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

describe("homepage redirect", () => {
  async function expectHomepageRedirect(expectedHref: string) {
    const pageModule = await import("@/app/page");

    await expect(Promise.resolve().then(() => pageModule.default())).rejects.toMatchObject({
      href: expectedHref,
    });

    expect(redirectMock).toHaveBeenCalledWith(expectedHref);
  }

  beforeEach(() => {
    requireUserMock.mockReset();
    redirectMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("redirects unauthenticated visitors to login", async () => {
    requireUserMock.mockRejectedValueOnce(
      new AuthGuardErrorMock(401, "Unauthorized"),
    );

    await expectHomepageRedirect("/login");
  });

  it("redirects regular users to the workspace", async () => {
    requireUserMock.mockResolvedValueOnce({
      userId: "user-1",
      role: "USER",
      forcePasswordChange: false,
    });

    await expectHomepageRedirect("/workspace");
  });

  it("redirects admins to the admin users page", async () => {
    requireUserMock.mockResolvedValueOnce({
      userId: "admin-1",
      role: "ADMIN",
      forcePasswordChange: false,
    });

    await expectHomepageRedirect("/admin/users");
  });

  it("sends users with a forced password change to the password reset flow", async () => {
    requireUserMock.mockResolvedValueOnce({
      userId: "user-1",
      role: "USER",
      forcePasswordChange: true,
    });

    await expectHomepageRedirect("/force-password");
  });
});
