import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useParamsMock, useTaskPollingMock, fetchMock, writeTextMock } = vi.hoisted(
  () => ({
    useParamsMock: vi.fn(),
    useTaskPollingMock: vi.fn(),
    fetchMock: vi.fn<typeof fetch>(),
    writeTextMock: vi.fn(),
  }),
);

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

async function renderPage() {
  const pageModule = await import(
    "@/app/(workspace)/projects/[projectId]/storyboard/page"
  );

  render(<pageModule.default />);
}

describe("project storyboard page", () => {
  beforeEach(() => {
    useParamsMock.mockReset();
    useTaskPollingMock.mockReset();
    fetchMock.mockReset();
    writeTextMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    useParamsMock.mockReturnValue({
      projectId: "project-1",
    });

    useTaskPollingMock.mockImplementation((taskId?: string | null) => ({
      task:
        taskId === "task-1"
          ? {
              id: "task-1",
              status: "SUCCEEDED",
              outputJson: {
                storyboardVersionId: "storyboard-1",
                segments: [
                  {
                    index: 1,
                    durationSeconds: 15,
                    scene: "Archive room",
                    shot: "Wide",
                    action: "The courier studies the vault.",
                    dialogue: "",
                    videoPrompt: "Slow push in on the courier.",
                  },
                ],
              },
            }
          : undefined,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
      isFinished: taskId === "task-1",
    }));

    fetchMock.mockImplementation(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === "/api/storyboards?projectId=project-1") {
        return jsonResponse({
          project: {
            id: "project-1",
            title: "Project One",
            idea: "Idea",
          },
          scriptVersions: [
            {
              id: "script-1",
              versionNumber: 1,
              body: "INT. ARCHIVE ROOM - NIGHT",
              createdAt: "2026-04-03T08:00:00.000Z",
            },
          ],
        });
      }

      if (url === "/api/storyboards" && init?.method === "POST") {
        return jsonResponse({ taskId: "task-1" }, 202);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
  });

  it("renders the shared workflow header and preserves storyboard generation", async () => {
    await renderPage();

    expect((await screen.findAllByText("项目制作流程")).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "分镜" })).toBeInTheDocument();
    expect(screen.getByText("Project One")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回项目制作台" })).toHaveAttribute(
      "href",
      "/projects/project-1",
    );
    expect(screen.getByText("脚本")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Generate storyboard" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/storyboards",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            projectId: "project-1",
            scriptVersionId: "script-1",
          }),
        }),
      );
    });

    expect(await screen.findByText("Storyboard generated.")).toBeInTheDocument();
    expect(screen.getByText("Archive room")).toBeInTheDocument();
    expect(screen.getByText("1 segments")).toBeInTheDocument();
  });
});
