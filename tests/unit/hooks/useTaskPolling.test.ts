import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useTaskPolling from "@/hooks/useTaskPolling";

const responses = [
  {
    id: "task-1",
    status: "RUNNING",
  },
  {
    id: "task-1",
    status: "SUCCEEDED",
  },
];

describe("useTaskPolling", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("polls a task until it reaches a terminal state", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(responses[0]), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(responses[1]), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      );

    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const { result } = renderHook(() => useTaskPolling("task-1"));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.task?.status).toBe("RUNNING");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.task?.status).toBe("SUCCEEDED");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
