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

describe("project images page", () => {
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

    fetchMock.mockImplementation(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === "/api/images?projectId=project-1") {
        return jsonResponse({
          project: {
            id: "project-1",
            title: "Project One",
            idea: "Idea",
          },
          maxUploadMb: 25,
          assets: [
            {
              id: "asset-1",
              kind: "image_generated",
              mimeType: "image/png",
              sizeBytes: 1234,
              previewDataUrl: "data:image/png;base64,abcd",
              createdAt: new Date().toISOString(),
              taskId: "task-99",
            },
          ],
        });
      }

      if (url === "/api/images" && init?.method === "POST") {
        return jsonResponse({ taskId: "task-1" }, 202);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
  });

  it("submits text-to-image tasks", async () => {
    const pageModule = await import("@/app/(workspace)/projects/[projectId]/images/page");

    render(<pageModule.default />);

    expect(await screen.findByRole("heading", { name: "Project One" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Image prompt input"), {
      target: { value: "Generate key art." },
    });

    fireEvent.click(screen.getByRole("button", { name: "Generate image" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/images",
        expect.objectContaining({
          method: "POST",
          body: expect.any(FormData),
        }),
      );
    });

    const call = fetchMock.mock.calls.find((entry) => entry[0] === "/api/images");
    const init = call?.[1] as RequestInit | undefined;
    const form = init?.body as FormData;

    expect(form.get("projectId")).toBe("project-1");
    expect(form.get("prompt")).toBe("Generate key art.");
    expect(form.get("sourceAssetId")).toBeNull();
  });

  it("submits image-to-image tasks with a reference asset restricted to the current project", async () => {
    const pageModule = await import("@/app/(workspace)/projects/[projectId]/images/page");

    render(<pageModule.default />);

    await screen.findByRole("heading", { name: "Project One" });

    fireEvent.click(screen.getByRole("button", { name: "Switch to image-to-image" }));

    const select = await screen.findByLabelText("Reference image asset");

    fireEvent.change(select, {
      target: { value: "asset-1" },
    });

    fireEvent.change(screen.getByLabelText("Image prompt input"), {
      target: { value: "Transform this." },
    });

    fireEvent.click(screen.getByRole("button", { name: "Generate image" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls
        .filter((entry) => entry[0] === "/api/images")
        .at(-1);
      const init = call?.[1] as RequestInit | undefined;
      const form = init?.body as FormData;

      expect(form.get("sourceAssetId")).toBe("asset-1");
      expect(form.get("projectId")).toBe("project-1");
    });
  });

  it("surfaces refresh failures after a succeeded task instead of claiming success", async () => {
    let workspaceFetchCount = 0;

    useTaskPollingMock.mockImplementation((taskId?: string | null) => ({
      task:
        taskId === "task-1"
          ? {
              id: "task-1",
              status: "SUCCEEDED",
              outputJson: { ok: true, outputAssetId: "asset-2" },
            }
          : undefined,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
      isFinished: false,
    }));

    fetchMock.mockImplementation(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === "/api/images?projectId=project-1") {
        workspaceFetchCount += 1;

        if (workspaceFetchCount >= 2) {
          return jsonResponse({ error: "Failed to load images" }, 500);
        }

        return jsonResponse({
          project: {
            id: "project-1",
            title: "Project One",
            idea: "Idea",
          },
          maxUploadMb: 25,
          assets: [],
        });
      }

      if (url === "/api/images" && init?.method === "POST") {
        return jsonResponse({ taskId: "task-1" }, 202);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const pageModule = await import("@/app/(workspace)/projects/[projectId]/images/page");

    render(<pageModule.default />);

    await screen.findByRole("heading", { name: "Project One" });

    fireEvent.change(screen.getByLabelText("Image prompt input"), {
      target: { value: "Generate key art." },
    });

    fireEvent.click(screen.getByRole("button", { name: "Generate image" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/images",
        expect.objectContaining({ method: "POST" }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/failed to refresh/i)).toBeInTheDocument();
    });

    expect(screen.queryByText("Image generated.")).not.toBeInTheDocument();
  });

  it("ignores stale workspace responses when projectId changes mid-flight", async () => {
    const pendingResponses = new Map<string, (value: Response) => void>();

    function deferredJsonResponse(url: string) {
      let resolve!: (value: Response) => void;
      const promise = new Promise<Response>((res) => {
        resolve = res;
      });
      pendingResponses.set(url, resolve);
      return promise;
    }

    useParamsMock.mockReturnValue({
      projectId: "project-a",
    });

    fetchMock.mockImplementation(async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === "/api/images?projectId=project-a") {
        return deferredJsonResponse(url);
      }

      if (url === "/api/images?projectId=project-b") {
        return jsonResponse(
          {
            project: { id: "project-b", title: "Project B", idea: null },
            maxUploadMb: 25,
            assets: [],
          },
          200,
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const pageModule = await import("@/app/(workspace)/projects/[projectId]/images/page");
    const { rerender } = render(<pageModule.default />);

    // Navigate before the first workspace request resolves.
    useParamsMock.mockReturnValue({
      projectId: "project-b",
    });
    rerender(<pageModule.default />);

    expect(await screen.findByRole("heading", { name: "Project B" })).toBeInTheDocument();

    const resolveA = pendingResponses.get("/api/images?projectId=project-a");
    expect(resolveA).toBeDefined();

    resolveA!(
      jsonResponse(
        {
          project: { id: "project-a", title: "Project A", idea: null },
          maxUploadMb: 25,
          assets: [],
        },
        200,
      ),
    );

    // Allow any state updates to flush; stale A response must not overwrite B.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Project B" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("heading", { name: "Project A" })).not.toBeInTheDocument();
  });
});
