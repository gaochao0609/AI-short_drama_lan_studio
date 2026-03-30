import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn<typeof fetch>(),
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function createTask(status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED") {
  return {
    id: "task-1",
    type: "VIDEO",
    status,
    errorText: null,
    cancelRequestedAt: null,
    createdAt: new Date("2026-03-30T10:00:00.000Z").toISOString(),
    updatedAt: new Date("2026-03-30T10:05:00.000Z").toISOString(),
    project: {
      id: "project-1",
      title: "Project One",
      owner: {
        id: "user-1",
        username: "owner-1",
      },
    },
    createdBy: {
      id: "user-1",
      username: "owner-1",
    },
    retryHistory: [],
  };
}

describe("admin tasks page", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("shows the finished task status when cancel returns a completed response", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === "/api/admin/tasks" && init?.cache === "no-store") {
        return jsonResponse({
          tasks: [fetchMock.mock.calls.length <= 1 ? createTask("RUNNING") : createTask("SUCCEEDED")],
        });
      }

      if (url === "/api/admin/tasks/task-1/cancel" && init?.method === "POST") {
        return jsonResponse(
          {
            taskId: "task-1",
            status: "SUCCEEDED",
            cancelRequestedAt: null,
          },
          200,
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const pageModule = await import("@/app/admin/tasks/page");

    render(<pageModule.default />);

    await screen.findByRole("heading", { name: "Task Monitoring" });

    fireEvent.click(await screen.findByRole("button", { name: "Cancel task" }));

    await waitFor(() => {
      expect(screen.getByText("Task task-1 already finished as Succeeded.")).toBeInTheDocument();
    });
    expect(screen.queryByText("Cancel request submitted for task-1.")).not.toBeInTheDocument();
  });
});
