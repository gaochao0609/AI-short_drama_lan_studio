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

  it("renders the shared workflow header and preserves image generation", async () => {
    const pageModule = await import("@/app/(workspace)/projects/[projectId]/images/page");

    render(<pageModule.default />);

    expect((await screen.findAllByText("项目制作流程")).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "图片" })).toBeInTheDocument();
    expect(screen.getByText("Project One")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回项目制作台" })).toHaveAttribute(
      "href",
      "/projects/project-1",
    );
    expect(screen.getByText("脚本")).toBeInTheDocument();

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

  it("ignores stale workspace failures when projectId changes mid-flight", async () => {
    const pendingRejects = new Map<string, (error: Error) => void>();

    function deferredFailure(url: string) {
      let reject!: (error: Error) => void;
      const promise = new Promise<Response>((_, rej) => {
        reject = rej;
      });
      pendingRejects.set(url, reject);
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
        return deferredFailure(url);
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

    // Navigate before A fails.
    useParamsMock.mockReturnValue({
      projectId: "project-b",
    });
    rerender(<pageModule.default />);

    expect(await screen.findByRole("heading", { name: "Project B" })).toBeInTheDocument();

    const rejectA = pendingRejects.get("/api/images?projectId=project-a");
    expect(rejectA).toBeDefined();
    rejectA!(new Error("Network timeout"));

    // Allow any state updates to flush; stale A failure must not overwrite B state.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Project B" })).toBeInTheDocument();
    });
    expect(screen.queryByText(/network timeout/i)).not.toBeInTheDocument();
  });

  it("ignores stale refresh failures after success when projectId changes", async () => {
    const pendingResponses = new Map<string, (value: Response) => void>();

    function deferredResponse(url: string) {
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

    useTaskPollingMock.mockImplementation((taskId?: string | null) => ({
      task:
        taskId === "task-a"
          ? {
              id: "task-a",
              status: "SUCCEEDED",
              outputJson: { ok: true, outputAssetId: "asset-a2" },
            }
          : undefined,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
      isFinished: false,
    }));

    let requestCountA = 0;

    fetchMock.mockImplementation(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === "/api/images?projectId=project-a") {
        requestCountA += 1;

        if (requestCountA === 1) {
          return jsonResponse(
            {
              project: { id: "project-a", title: "Project A", idea: null },
              maxUploadMb: 25,
              assets: [],
            },
            200,
          );
        }

        // Second request is the post-success refresh: resolve later with failure.
        return deferredResponse(url);
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

      if (url === "/api/images" && init?.method === "POST") {
        return jsonResponse({ taskId: "task-a" }, 202);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const pageModule = await import("@/app/(workspace)/projects/[projectId]/images/page");
    const { rerender } = render(<pageModule.default />);

    expect(await screen.findByRole("heading", { name: "Project A" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Image prompt input"), {
      target: { value: "Generate." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate image" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/images",
        expect.objectContaining({ method: "POST" }),
      );
    });

    // Wait until the post-success refresh request for project-a is in-flight.
    await waitFor(() => {
      expect(pendingResponses.has("/api/images?projectId=project-a")).toBe(true);
    });

    // Navigate while the refresh for project-a is still pending.
    useParamsMock.mockReturnValue({
      projectId: "project-b",
    });
    rerender(<pageModule.default />);

    expect(await screen.findByRole("heading", { name: "Project B" })).toBeInTheDocument();

    const resolveRefreshA = pendingResponses.get("/api/images?projectId=project-a");
    expect(resolveRefreshA).toBeDefined();
    resolveRefreshA!(jsonResponse({ error: "Refresh failed" }, 500));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Project B" })).toBeInTheDocument();
    });
    expect(screen.queryByText(/refresh failed/i)).not.toBeInTheDocument();
  });

  it("clears prior project state when navigating to a new project", async () => {
    const pendingResponses = new Map<string, (value: Response) => void>();

    function deferredResponse(url: string) {
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

    fetchMock.mockImplementation(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === "/api/images?projectId=project-a") {
        return jsonResponse(
          {
            project: { id: "project-a", title: "Project A", idea: null },
            maxUploadMb: 25,
            assets: [
              {
                id: "asset-a1",
                kind: "image_generated",
                mimeType: "image/png",
                sizeBytes: 1234,
                previewDataUrl: "data:image/png;base64,abcd",
                createdAt: new Date().toISOString(),
                taskId: "task-1",
              },
            ],
          },
          200,
        );
      }

      if (url === "/api/images?projectId=project-b") {
        return deferredResponse(url);
      }

      if (url === "/api/images" && init?.method === "POST") {
        return jsonResponse({ taskId: "task-a" }, 202);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const pageModule = await import("@/app/(workspace)/projects/[projectId]/images/page");
    const { rerender } = render(<pageModule.default />);

    expect(await screen.findByRole("heading", { name: "Project A" })).toBeInTheDocument();
    expect(screen.getByText("asset-a1")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Image prompt input"), {
      target: { value: "Generate." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate image" }));

    expect(await screen.findByText("Image task queued.")).toBeInTheDocument();
    expect(screen.getByText(/Task: task-a/i)).toBeInTheDocument();

    useParamsMock.mockReturnValue({
      projectId: "project-b",
    });
    rerender(<pageModule.default />);

    await waitFor(() => {
      expect(screen.getByText("加载项目中...")).toBeInTheDocument();
    });

    expect(screen.queryByText("asset-a1")).not.toBeInTheDocument();
    expect(screen.queryByText("Image task queued.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Task: task-a/i)).not.toBeInTheDocument();

    const resolveB = pendingResponses.get("/api/images?projectId=project-b");
    expect(resolveB).toBeDefined();
    resolveB!(
      jsonResponse(
        {
          project: { id: "project-b", title: "Project B", idea: null },
          maxUploadMb: 25,
          assets: [],
        },
        200,
      ),
    );

    expect(await screen.findByRole("heading", { name: "Project B" })).toBeInTheDocument();
  });

  it("ignores stale enqueue responses when navigating to a new project", async () => {
    const pendingPosts = new Map<string, (value: Response) => void>();

    function deferredPost(url: string) {
      let resolve!: (value: Response) => void;
      const promise = new Promise<Response>((res) => {
        resolve = res;
      });
      pendingPosts.set(url, resolve);
      return promise;
    }

    useParamsMock.mockReturnValue({
      projectId: "project-a",
    });

    fetchMock.mockImplementation(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === "/api/images?projectId=project-a") {
        return jsonResponse(
          {
            project: { id: "project-a", title: "Project A", idea: null },
            maxUploadMb: 25,
            assets: [],
          },
          200,
        );
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

      if (url === "/api/images" && init?.method === "POST") {
        return deferredPost(url);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const pageModule = await import("@/app/(workspace)/projects/[projectId]/images/page");
    const { rerender } = render(<pageModule.default />);

    expect(await screen.findByRole("heading", { name: "Project A" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Image prompt input"), {
      target: { value: "Generate." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate image" }));

    await waitFor(() => {
      expect(pendingPosts.has("/api/images")).toBe(true);
    });

    useParamsMock.mockReturnValue({
      projectId: "project-b",
    });
    rerender(<pageModule.default />);

    expect(await screen.findByRole("heading", { name: "Project B" })).toBeInTheDocument();

    const resolvePost = pendingPosts.get("/api/images");
    expect(resolvePost).toBeDefined();
    resolvePost!(jsonResponse({ taskId: "task-a" }, 202));

    // Allow any state updates to flush; stale A enqueue must not appear on B.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Project B" })).toBeInTheDocument();
    });
    expect(screen.queryByText("Image task queued.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Task: task-a/i)).not.toBeInTheDocument();
  });

  it("does not let a stale enqueue finally clear the new project's submitting state", async () => {
    const pendingPostResolvers: Array<(value: Response) => void> = [];

    function deferredPost() {
      let resolve!: (value: Response) => void;
      const promise = new Promise<Response>((res) => {
        resolve = res;
      });
      pendingPostResolvers.push(resolve);
      return promise;
    }

    useParamsMock.mockReturnValue({
      projectId: "project-a",
    });

    fetchMock.mockImplementation(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === "/api/images?projectId=project-a") {
        return jsonResponse(
          {
            project: { id: "project-a", title: "Project A", idea: null },
            maxUploadMb: 25,
            assets: [],
          },
          200,
        );
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

      if (url === "/api/images" && init?.method === "POST") {
        return deferredPost();
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const pageModule = await import("@/app/(workspace)/projects/[projectId]/images/page");
    const { rerender } = render(<pageModule.default />);

    expect(await screen.findByRole("heading", { name: "Project A" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Image prompt input"), {
      target: { value: "Generate A." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate image" }));

    await waitFor(() => {
      expect(pendingPostResolvers.length).toBe(1);
    });

    useParamsMock.mockReturnValue({
      projectId: "project-b",
    });
    rerender(<pageModule.default />);

    expect(await screen.findByRole("heading", { name: "Project B" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Image prompt input"), {
      target: { value: "Generate B." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate image" }));

    await waitFor(() => {
      expect(pendingPostResolvers.length).toBe(2);
    });

    const submitButton = screen.getByRole("button", { name: "Generate image" });
    expect(submitButton).toBeDisabled();

    // Resolve A first (stale). This must not clear B's submitting state.
    pendingPostResolvers[0]!(jsonResponse({ taskId: "task-a" }, 202));

    // With the bug, A's finally sets isSubmitting(false) and the button becomes enabled
    // while B's request is still pending. That must never happen.
    await expect(async () => {
      await waitFor(
        () => {
          expect(screen.getByRole("button", { name: "Generate image" })).toBeEnabled();
        },
        { timeout: 150 },
      );
    }).rejects.toThrow();

    // Now resolve B and ensure the task is applied to B.
    pendingPostResolvers[1]!(jsonResponse({ taskId: "task-b" }, 202));

    expect(await screen.findByText(/Task: task-b/i)).toBeInTheDocument();
  });
});
