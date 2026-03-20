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

  it("keeps polling every 3 seconds after repeated fetch errors", async () => {
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
      await vi.advanceTimersByTimeAsync(12_000);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("keeps polling after transient errors until the task reaches a terminal state", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
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

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.task?.status).toBe("SUCCEEDED");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not start a new poll while the previous request is still in flight", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    renderHook(() => useTaskPolling("task-1"), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch?.(
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
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not let a stale completion from the previous task clear the current in-flight guard", async () => {
    const resolvers = new Map<string, (response: Response) => void>();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (input) =>
        new Promise((resolve) => {
          resolvers.set(String(input), resolve);
        }),
    );

    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const { rerender } = renderHook(({ taskId }) => useTaskPolling(taskId), {
      initialProps: { taskId: "task-a" },
      wrapper: createWrapper(),
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    rerender({ taskId: "task-b" });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolvers.get("/api/tasks/task-a")?.(
        new Response(
          JSON.stringify({
            id: "task-a",
            status: "RUNNING",
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolvers.get("/api/tasks/task-b")?.(
        new Response(
          JSON.stringify({
            id: "task-b",
            status: "RUNNING",
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
