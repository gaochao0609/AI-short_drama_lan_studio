"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useTaskPolling from "@/hooks/useTaskPolling";

type StoryboardSegment = {
  index: number;
  durationSeconds: number;
  scene: string;
  shot: string;
  action: string;
  dialogue: string;
  videoPrompt: string;
};

type StoryboardTaskOutput = {
  storyboardVersionId?: string;
  segments?: StoryboardSegment[];
};

type TaskPollResponse = {
  id: string;
  status: string;
  outputJson?: StoryboardTaskOutput | null;
  errorText?: string | null;
};

type ScriptVersionSummary = {
  id: string;
  versionNumber: number;
  body?: string | null;
  createdAt: string;
};

type ProjectResponse = {
  id: string;
  title: string;
  idea?: string | null;
  scriptVersions: ScriptVersionSummary[];
};

export default function ProjectStoryboardPage() {
  const params = useParams<{ projectId: string }>();
  const [projectId, setProjectId] = useState("");
  const [project, setProject] = useState<ProjectResponse | null>(null);
  const [selectedScriptVersionId, setSelectedScriptVersionId] = useState<string | null>(null);
  const [storyboardResult, setStoryboardResult] = useState<StoryboardTaskOutput | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingProject, setIsLoadingProject] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedSegmentIndex, setCopiedSegmentIndex] = useState<number | null>(null);
  const { task, error: pollingError } = useTaskPolling(activeTaskId);

  useEffect(() => {
    setProjectId(params.projectId ?? "");
  }, [params]);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    let cancelled = false;

    async function loadProject() {
      setIsLoadingProject(true);

      try {
        const response = await fetch(`/api/projects/${projectId}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as
          | ProjectResponse
          | { error?: string }
          | null;

        if (!response.ok) {
          throw new Error(
            payload && "error" in payload
              ? payload.error ?? "Failed to load project"
              : "Failed to load project",
          );
        }

        if (!cancelled && payload && "scriptVersions" in payload) {
          setProject(payload);
          setSelectedScriptVersionId((current) => {
            const currentVersionStillExists =
              current &&
              payload.scriptVersions.some((version) => version.id === current);

            return currentVersionStillExists ? current : payload.scriptVersions[0]?.id ?? null;
          });
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load project",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingProject(false);
        }
      }
    }

    void loadProject();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!activeTaskId || !pollingError) {
      return;
    }

    setActiveTaskId(null);
    setStatusMessage(null);
    setError(
      pollingError instanceof Error
        ? pollingError.message
        : "Failed to fetch task",
    );
  }, [activeTaskId, pollingError]);

  useEffect(() => {
    const polledTask = task as TaskPollResponse | undefined;

    if (!activeTaskId || !polledTask) {
      return;
    }

    if (polledTask.status === "RUNNING" || polledTask.status === "QUEUED") {
      setStatusMessage("Generating storyboard segments...");
      setError(null);
      return;
    }

    if (polledTask.status === "SUCCEEDED") {
      setStoryboardResult(polledTask.outputJson ?? null);
      setStatusMessage("Storyboard generated.");
      setError(null);
      setActiveTaskId(null);
      return;
    }

    if (polledTask.status === "FAILED" || polledTask.status === "CANCELED") {
      setStoryboardResult(null);
      setStatusMessage(null);
      setError(polledTask.errorText ?? "Storyboard generation failed");
      setActiveTaskId(null);
    }
  }, [activeTaskId, task]);

  const selectedScriptVersion = useMemo(() => {
    if (!project || !selectedScriptVersionId) {
      return null;
    }

    return project.scriptVersions.find((version) => version.id === selectedScriptVersionId) ?? null;
  }, [project, selectedScriptVersionId]);

  const storyboardSegments = storyboardResult?.segments ?? [];
  const isBusy = isLoadingProject || isSubmitting || Boolean(activeTaskId);
  const canGenerate = Boolean(projectId && selectedScriptVersionId && !isBusy);

  async function handleGenerateStoryboard() {
    if (!projectId || !selectedScriptVersionId) {
      setError("Select a script version before generating a storyboard");
      return;
    }

    setError(null);
    setStatusMessage(null);
    setIsSubmitting(true);
    setStoryboardResult(null);

    try {
      const response = await fetch("/api/storyboards", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          projectId,
          scriptVersionId: selectedScriptVersionId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { taskId?: string; error?: string }
        | null;

      if (!response.ok || !payload?.taskId) {
        throw new Error(payload?.error ?? "Storyboard request failed");
      }

      setActiveTaskId(payload.taskId);
      setStatusMessage("Storyboard task queued.");
    } catch (submitError) {
      setStatusMessage(null);
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Storyboard request failed",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCopyVideoPrompt(segment: StoryboardSegment) {
    try {
      await navigator.clipboard.writeText(segment.videoPrompt);
      setCopiedSegmentIndex(segment.index);
      window.setTimeout(() => {
        setCopiedSegmentIndex((current) =>
          current === segment.index ? null : current,
        );
      }, 1500);
    } catch {
      setError("Unable to copy the video prompt");
    }
  }

  return (
    <section style={pageStyle}>
      <header style={heroStyle}>
        <div>
          <p style={eyebrowStyle}>Storyboard Workflow</p>
          <h2 style={heroTitleStyle}>
            {isLoadingProject ? "Loading project..." : project?.title ?? "Storyboard"}
          </h2>
          <p style={heroCopyStyle}>
            Pick a full script version, generate 15-second storyboard segments, then copy
            the prompt for any single segment.
          </p>
        </div>
        <div style={heroActionsStyle}>
          <Link href="/workspace" style={secondaryLinkStyle}>
            Back to workspace
          </Link>
          <Link href={`/projects/${projectId}`} style={secondaryLinkStyle}>
            Back to project
          </Link>
        </div>
      </header>

      {error ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : null}
      {statusMessage ? (
        <p role="status" style={messageStyle}>
          {statusMessage}
        </p>
      ) : null}

      <div style={gridStyle}>
        <section style={panelStyle}>
          <h3 style={panelTitleStyle}>Script Versions</h3>
          <p style={panelCopyStyle}>
            Only script versions belonging to this project are available here.
          </p>

          {project?.scriptVersions?.length ? (
            <label style={fieldStyle}>
              <span>Select a full script version</span>
              <select
                aria-label="Select script version"
                value={selectedScriptVersionId ?? ""}
                onChange={(event) => {
                  setSelectedScriptVersionId(event.target.value || null);
                  setStoryboardResult(null);
                }}
                style={selectStyle}
                disabled={isBusy}
              >
                {project.scriptVersions.map((version) => (
                  <option key={version.id} value={version.id}>
                    Version {version.versionNumber} - {new Date(version.createdAt).toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p style={emptyStyle}>No script versions are available for this project yet.</p>
          )}

          {selectedScriptVersion ? (
            <article style={versionPreviewStyle}>
              <p style={versionLabelStyle}>Version {selectedScriptVersion.versionNumber}</p>
              <pre style={scriptPreviewStyle}>
                {selectedScriptVersion.body?.trim() || "No script body recorded."}
              </pre>
            </article>
          ) : null}

          <button
            type="button"
            onClick={handleGenerateStoryboard}
            style={primaryButtonStyle}
            disabled={!canGenerate}
          >
            Generate storyboard
          </button>
        </section>

        <section style={panelStyle}>
          <h3 style={panelTitleStyle}>Generation Status</h3>
          <p style={panelCopyStyle}>
            Queue a storyboard task, then watch the current task through polling.
          </p>

          {activeTaskId ? (
            <article style={taskCardStyle}>
              <p style={taskLabelStyle}>Task ID</p>
              <strong>{activeTaskId}</strong>
              <p style={taskMetaStyle}>Status: {task ? task.status : "Queued"}</p>
            </article>
          ) : (
            <p style={emptyStyle}>No storyboard task is currently running.</p>
          )}

          {storyboardSegments.length > 0 ? (
            <article style={taskCardStyle}>
              <p style={taskLabelStyle}>Generated Segments</p>
              <strong>{storyboardSegments.length} segments</strong>
            </article>
          ) : null}
        </section>
      </div>

      <section style={panelStyle}>
        <h3 style={panelTitleStyle}>Storyboard Segments</h3>
        <p style={panelCopyStyle}>
          Each segment is validated to 15 seconds and can be copied as a video prompt.
        </p>

        {storyboardSegments.length === 0 ? (
          <p style={emptyStyle}>Storyboard results will appear here after generation completes.</p>
        ) : (
          <div style={segmentGridStyle}>
            {storyboardSegments.map((segment) => (
              <article key={segment.index} style={segmentCardStyle}>
                <div style={segmentHeaderStyle}>
                  <div>
                    <p style={segmentIndexStyle}>Segment {segment.index}</p>
                    <strong>{segment.durationSeconds} seconds</strong>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopyVideoPrompt(segment)}
                    style={copyButtonStyle}
                  >
                    {copiedSegmentIndex === segment.index ? "Copied" : "Copy prompt"}
                  </button>
                </div>

                <div style={segmentFieldGroupStyle}>
                  <div>
                    <p style={segmentFieldLabelStyle}>Scene</p>
                    <p style={segmentFieldValueStyle}>{segment.scene}</p>
                  </div>
                  <div>
                    <p style={segmentFieldLabelStyle}>Shot</p>
                    <p style={segmentFieldValueStyle}>{segment.shot}</p>
                  </div>
                  <div>
                    <p style={segmentFieldLabelStyle}>Action</p>
                    <p style={segmentFieldValueStyle}>{segment.action}</p>
                  </div>
                  <div>
                    <p style={segmentFieldLabelStyle}>Dialogue</p>
                    <p style={segmentFieldValueStyle}>{segment.dialogue || "No dialogue"}</p>
                  </div>
                  <div>
                    <p style={segmentFieldLabelStyle}>Video Prompt</p>
                    <pre style={videoPromptStyle}>{segment.videoPrompt}</pre>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

const pageStyle = {
  display: "grid",
  gap: "20px",
} satisfies CSSProperties;

const heroStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "16px",
  alignItems: "flex-start",
  padding: "24px",
  borderRadius: "24px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
  background: "rgba(255, 250, 243, 0.92)",
} satisfies CSSProperties;

const eyebrowStyle = {
  margin: 0,
  color: "#8c5f2d",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  fontSize: "0.8rem",
} satisfies CSSProperties;

const heroTitleStyle = {
  margin: "10px 0 0",
  fontSize: "2rem",
} satisfies CSSProperties;

const heroCopyStyle = {
  margin: "12px 0 0",
  color: "#665d52",
  lineHeight: 1.6,
  maxWidth: "720px",
} satisfies CSSProperties;

const heroActionsStyle = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
} satisfies CSSProperties;

const gridStyle = {
  display: "grid",
  gap: "20px",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
} satisfies CSSProperties;

const panelStyle = {
  display: "grid",
  gap: "16px",
  padding: "20px",
  borderRadius: "24px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
  background: "rgba(255, 250, 243, 0.9)",
} satisfies CSSProperties;

const panelTitleStyle = {
  margin: 0,
  fontSize: "1.2rem",
} satisfies CSSProperties;

const panelCopyStyle = {
  margin: 0,
  color: "#665d52",
  lineHeight: 1.6,
} satisfies CSSProperties;

const fieldStyle = {
  display: "grid",
  gap: "8px",
  fontWeight: 600,
} satisfies CSSProperties;

const selectStyle = {
  width: "100%",
  borderRadius: "16px",
  border: "1px solid rgba(31, 27, 22, 0.16)",
  padding: "14px 16px",
  font: "inherit",
  background: "#fff",
} satisfies CSSProperties;

const versionPreviewStyle = {
  display: "grid",
  gap: "10px",
  padding: "16px",
  borderRadius: "18px",
  background: "rgba(140, 95, 45, 0.08)",
} satisfies CSSProperties;

const versionLabelStyle = {
  margin: 0,
  color: "#8c5f2d",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: "0.85rem",
} satisfies CSSProperties;

const scriptPreviewStyle = {
  margin: 0,
  whiteSpace: "pre-wrap",
  lineHeight: 1.65,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
} satisfies CSSProperties;

const primaryButtonStyle = {
  border: 0,
  borderRadius: "999px",
  background: "#8c5f2d",
  color: "#fff",
  padding: "12px 18px",
  font: "inherit",
  fontWeight: 700,
  cursor: "pointer",
} satisfies CSSProperties;

const secondaryLinkStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "999px",
  padding: "12px 18px",
  textDecoration: "none",
  background: "rgba(140, 95, 45, 0.12)",
  color: "#4b3a27",
  fontWeight: 700,
} satisfies CSSProperties;

const emptyStyle = {
  margin: 0,
  color: "#665d52",
} satisfies CSSProperties;

const messageStyle = {
  margin: 0,
  padding: "14px 16px",
  borderRadius: "16px",
  background: "rgba(23, 92, 49, 0.12)",
  color: "#175c31",
} satisfies CSSProperties;

const errorStyle = {
  margin: 0,
  padding: "14px 16px",
  borderRadius: "16px",
  background: "rgba(180, 35, 24, 0.12)",
  color: "#b42318",
} satisfies CSSProperties;

const taskCardStyle = {
  display: "grid",
  gap: "8px",
  padding: "16px",
  borderRadius: "18px",
  background: "rgba(140, 95, 45, 0.08)",
} satisfies CSSProperties;

const taskLabelStyle = {
  margin: 0,
  color: "#8c5f2d",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: "0.85rem",
} satisfies CSSProperties;

const taskMetaStyle = {
  margin: 0,
  color: "#665d52",
} satisfies CSSProperties;

const segmentGridStyle = {
  display: "grid",
  gap: "16px",
} satisfies CSSProperties;

const segmentCardStyle = {
  display: "grid",
  gap: "14px",
  padding: "18px",
  borderRadius: "20px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
  background: "#fff",
} satisfies CSSProperties;

const segmentHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "center",
} satisfies CSSProperties;

const segmentIndexStyle = {
  margin: 0,
  color: "#8c5f2d",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: "0.85rem",
} satisfies CSSProperties;

const copyButtonStyle = {
  border: 0,
  borderRadius: "999px",
  background: "rgba(140, 95, 45, 0.12)",
  color: "#4b3a27",
  padding: "10px 14px",
  font: "inherit",
  fontWeight: 700,
  cursor: "pointer",
} satisfies CSSProperties;

const segmentFieldGroupStyle = {
  display: "grid",
  gap: "12px",
} satisfies CSSProperties;

const segmentFieldLabelStyle = {
  margin: 0,
  color: "#8c5f2d",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: "0.78rem",
} satisfies CSSProperties;

const segmentFieldValueStyle = {
  margin: "6px 0 0",
  color: "#332b21",
  lineHeight: 1.6,
} satisfies CSSProperties;

const videoPromptStyle = {
  margin: "6px 0 0",
  padding: "14px",
  borderRadius: "16px",
  background: "rgba(140, 95, 45, 0.06)",
  whiteSpace: "pre-wrap",
  lineHeight: 1.6,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
} satisfies CSSProperties;
