import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useParamsMock, useTaskPollingMock, fetchMock } = vi.hoisted(() => ({
  useParamsMock: vi.fn(),
  useTaskPollingMock: vi.fn(),
  fetchMock: vi.fn<typeof fetch>(),
}));

vi.mock("next/navigation", () => ({
  useParams: useParamsMock,
}));

vi.mock("@/hooks/useTaskPolling", () => ({
  default: useTaskPollingMock,
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function sseResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
    },
  });
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

async function renderPage() {
  const pageModule = await import(
    "@/app/(workspace)/projects/[projectId]/script/page"
  );

  render(<pageModule.default />);
}

describe("project script page", () => {
  beforeEach(() => {
    useParamsMock.mockReset();
    useTaskPollingMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);

    useParamsMock.mockReturnValue({
      projectId: "project-1",
    });
    useTaskPollingMock.mockReturnValue({
      task: undefined,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
      isFinished: false,
    });
    fetchMock.mockImplementation(async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === "/api/projects/project-1") {
        return jsonResponse({
          id: "project-1",
          title: "Project One",
          idea: "Original idea",
        });
      }

      if (url === "/api/script/sessions") {
        return sseResponse(
          [
            "event: session\n",
            'data: {"sessionId":"session-1"}\n\n',
            "event: question\n",
            'data: {"delta":"Who is the hero?"}\n\n',
            "event: done\n",
            'data: {"questionText":"Who is the hero?"}\n\n',
          ].join(""),
          201,
        );
      }

      if (url === "/api/script/sessions/session-1/finalize") {
        return jsonResponse({ taskId: "task-1" }, 202);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
  });

  it("shows polling errors instead of staying stuck in the generating state", async () => {
    useTaskPollingMock.mockImplementation((taskId?: string | null) => ({
      task: undefined,
      error:
        taskId === "task-1" ? new Error("Failed to fetch task: 500") : undefined,
      isLoading: false,
      mutate: vi.fn(),
      isFinished: false,
    }));

    await renderPage();

    const startButton = await screen.findByRole("button", {
      name: "Start script session",
    });
    fireEvent.click(startButton);

    await screen.findByText("Who is the hero?");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Finalize script",
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("Failed to fetch task: 500"),
      ).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Finalize script",
        }),
      ).toBeEnabled();
    });
  });

  it("disables finalize while an active finalize task is still polling", async () => {
    useTaskPollingMock.mockImplementation((taskId?: string | null) => ({
      task: taskId === "task-1" ? { id: "task-1", status: "RUNNING" } : undefined,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
      isFinished: false,
    }));

    await renderPage();

    const startButton = await screen.findByRole("button", {
      name: "Start script session",
    });
    fireEvent.click(startButton);

    await screen.findByText("Who is the hero?");

    const finalizeButton = screen.getByRole("button", {
      name: "Finalize script",
    });
    fireEvent.click(finalizeButton);

    await waitFor(() => {
      expect(finalizeButton).toBeDisabled();
    });
  });

  it("freezes the full session UI while finalize polling is active", async () => {
    useTaskPollingMock.mockImplementation((taskId?: string | null) => ({
      task: taskId === "task-1" ? { id: "task-1", status: "RUNNING" } : undefined,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
      isFinished: false,
    }));

    await renderPage();

    fireEvent.change(await screen.findByLabelText("Script idea input"), {
      target: { value: "Updated idea" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Start script session",
      }),
    );

    await screen.findByText("Who is the hero?");

    fireEvent.change(screen.getByLabelText("Script answer input"), {
      target: { value: "A courier" },
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Finalize script",
      }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Script answer input")).toBeDisabled();
      expect(
        screen.getByRole("button", {
          name: "Send script answer",
        }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", {
          name: "Regenerate script question",
        }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", {
          name: "Reset script session",
        }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", {
          name: "Start script session",
        }),
      ).toBeDisabled();
    });
  });

  it("clears the generating status when finalize request fails", async () => {
    const finalizeRequest = createDeferred<Response>();

    fetchMock.mockImplementation(async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === "/api/projects/project-1") {
        return jsonResponse({
          id: "project-1",
          title: "Project One",
          idea: "Original idea",
        });
      }

      if (url === "/api/script/sessions") {
        return sseResponse(
          [
            "event: session\n",
            'data: {"sessionId":"session-1"}\n\n',
            "event: question\n",
            'data: {"delta":"Who is the hero?"}\n\n',
            "event: done\n",
            'data: {"questionText":"Who is the hero?"}\n\n',
          ].join(""),
          201,
        );
      }

      if (url === "/api/script/sessions/session-1/finalize") {
        return finalizeRequest.promise;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    await renderPage();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Start script session",
      }),
    );

    await screen.findByText("Who is the hero?");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Finalize script",
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    finalizeRequest.resolve(jsonResponse({ error: "Finalize failed" }, 500));

    await waitFor(() => {
      expect(screen.getByText("Finalize failed")).toBeInTheDocument();
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps the transcript aligned when answering fails mid-stream", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === "/api/projects/project-1") {
        return jsonResponse({
          id: "project-1",
          title: "Project One",
          idea: "Original idea",
        });
      }

      if (url === "/api/script/sessions") {
        return sseResponse(
          [
            "event: session\n",
            'data: {"sessionId":"session-1"}\n\n',
            "event: question\n",
            'data: {"delta":"Who is the hero?"}\n\n',
            "event: done\n",
            'data: {"questionText":"Who is the hero?"}\n\n',
          ].join(""),
          201,
        );
      }

      if (url === "/api/script/sessions/session-1/message") {
        return sseResponse(
          [
            "event: question\n",
            'data: {"delta":"What city"}\n\n',
            "event: error\n",
            'data: {"message":"Next question generation failed"}\n\n',
          ].join(""),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    await renderPage();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Start script session",
      }),
    );

    await screen.findByText("Who is the hero?");

    fireEvent.change(screen.getByLabelText("Script answer input"), {
      target: { value: "A courier" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Send script answer",
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("Next question generation failed"),
      ).toBeInTheDocument();
    });

    const originalQuestionCard = screen.getByText("Who is the hero?").closest("article");

    expect(screen.queryByText("What city")).not.toBeInTheDocument();
    expect(originalQuestionCard).not.toHaveTextContent("A courier");
    expect(screen.getByLabelText("Script answer input")).toHaveValue("A courier");
    expect(screen.getAllByText("Who is the hero?")).toHaveLength(1);
  });

  it("keeps the session controls disabled after finalize polling succeeds", async () => {
    useTaskPollingMock.mockImplementation((taskId?: string | null) => ({
      task:
        taskId === "task-1"
          ? {
              id: "task-1",
              status: "SUCCEEDED",
              outputJson: {
                body: "Final script body",
              },
            }
          : undefined,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
      isFinished: taskId === "task-1",
    }));

    await renderPage();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Start script session",
      }),
    );

    await screen.findByText("Who is the hero?");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Finalize script",
      }),
    );

    await screen.findByText("Final script body");

    expect(screen.getByLabelText("Script answer input")).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Send script answer",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Regenerate script question",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Finalize script",
      }),
    ).toBeDisabled();
  });
});
