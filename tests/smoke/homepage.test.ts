import { describe, expect, it } from "vitest";

describe("homepage shell", () => {
  it("has a root app entry file", async () => {
    const mod = await import("@/app/page");
    expect(mod).toBeTruthy();
  });
});
