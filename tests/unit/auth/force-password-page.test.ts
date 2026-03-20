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
    fireEvent.submit(screen.getByRole("button", { name: "保存新密码" }).closest("form")!);

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith("/");
    });
  });
});
