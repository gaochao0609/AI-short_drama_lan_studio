import { createElement, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { SWRConfig } from "swr";
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

function createWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      SWRConfig,
      {
        value: {
          provider: () => new Map(),
          dedupingInterval: 0,
        },
      },
      children,
    );
  };
}

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

    const { result } = renderHook(() => useTaskPolling("task-1"), {
      wrapper: createWrapper(),
    });

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

  it("stops polling after repeated fetch errors", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("network unavailable"));

    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const { result } = renderHook(() => useTaskPolling("task-1"), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600_000);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("can recover from capped errors on reconnect", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "task-1",
            status: "RUNNING",
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "task-1",
            status: "SUCCEEDED",
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      );

    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const { result } = renderHook(() => useTaskPolling("task-1"), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      window.dispatchEvent(new Event("online"));
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
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
