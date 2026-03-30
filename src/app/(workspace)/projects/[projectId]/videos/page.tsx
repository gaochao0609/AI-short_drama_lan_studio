"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import useTaskPolling from "@/hooks/useTaskPolling";

type AssetSummary = {
  id: string;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  taskId?: string | null;
  createdAt: string;
  previewDataUrl?: string | null;
};

type VideoTaskSummary = {
  id: string;
  status: string;
  createdAt: string;
  errorText?: string | null;
  outputJson?: {
    ok?: boolean;
    outputAssetId?: string;
  } | null;
};

type VideosWorkspaceResponse = {
  project: {
    id: string;
    title: string;
    idea?: string | null;
  };
  referenceAssets: AssetSummary[];
  videoAssets: AssetSummary[];
  tasks: VideoTaskSummary[];
};

type TaskPollResponse = {
  id: string;
  status: string;
  outputJson?: {
    ok?: boolean;
    outputAssetId?: string;
  } | null;
  errorText?: string | null;
};

const EMPTY_ASSETS: AssetSummary[] = [];
const EMPTY_TASKS: VideoTaskSummary[] = [];

export default function ProjectVideosPage() {
  const params = useParams<{ projectId: string }>();
  const routeProjectId = params.projectId ?? "";
  const latestRouteProjectIdRef = useRef(routeProjectId);
  latestRouteProjectIdRef.current = routeProjectId;
  const workspaceRequestSeq = useRef(0);
  const submitRequestSeq = useRef(0);
  const [projectId, setProjectId] = useState("");
  const [workspace, setWorkspace] = useState<VideosWorkspaceResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { task, error: pollingError } = useTaskPolling(activeTaskId);

  useEffect(() => {
    setProjectId(params.projectId ?? "");
  }, [params]);

  async function reloadWorkspace(nextProjectId: string): Promise<boolean> {
    const requestId = (workspaceRequestSeq.current += 1);

    try {
      const response = await fetch(`/api/videos?projectId=${encodeURIComponent(nextProjectId)}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | VideosWorkspaceResponse
        | { error?: string }
        | null;

      if (!response.ok || !payload || !("project" in payload)) {
        if (requestId !== workspaceRequestSeq.current) {
          return false;
        }

        throw new Error(
          payload && "error" in payload
            ? payload.error ?? "Failed to load videos"
            : "Failed to load videos",
        );
      }

      if (requestId !== workspaceRequestSeq.current) {
        return false;
      }

      setWorkspace(payload);
      return true;
    } catch (loadError) {
      if (requestId !== workspaceRequestSeq.current) {
        return false;
      }

      throw loadError;
    }
  }

  useEffect(() => {
    if (!projectId) {
      return;
    }

    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setWorkspace(null);
      setActiveTaskId(null);
      setStatusMessage(null);
      setError(null);
      setIsSubmitting(false);
      setSelectedReferenceIds([]);

      try {
        await reloadWorkspace(projectId);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load videos");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();

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
    setError(pollingError instanceof Error ? pollingError.message : "Failed to fetch task");
  }, [activeTaskId, pollingError]);

  useEffect(() => {
    const polledTask = task as TaskPollResponse | undefined;

    if (!activeTaskId || !polledTask) {
      return;
    }

    if (polledTask.status === "RUNNING" || polledTask.status === "QUEUED") {
      setStatusMessage("Generating video...");
      setError(null);
      return;
    }

    if (polledTask.status === "SUCCEEDED") {
      setError(null);
      setActiveTaskId(null);
      setStatusMessage("Refreshing results...");

      if (!projectId) {
        setStatusMessage("Video generated.");
        return;
      }

      void (async () => {
        try {
          const applied = await reloadWorkspace(projectId);
          if (!applied) {
            return;
          }

          setStatusMessage("Video generated.");
        } catch (refreshError) {
          setStatusMessage(null);
          const message =
            refreshError instanceof Error ? refreshError.message : "Failed to load videos";
          setError(`Video generated, but failed to refresh results: ${message}`);
        }
      })();
      return;
    }

    if (polledTask.status === "FAILED" || polledTask.status === "CANCELED") {
      setStatusMessage(null);
      setError(polledTask.errorText ?? "Video generation failed");
      setActiveTaskId(null);
    }
  }, [activeTaskId, projectId, task]);

  const referenceAssets = workspace?.referenceAssets ?? EMPTY_ASSETS;
  const videoAssets = workspace?.videoAssets ?? EMPTY_ASSETS;
  const recentTasks = workspace?.tasks ?? EMPTY_TASKS;
  const selectedReferences = useMemo(
    () => referenceAssets.filter((asset) => selectedReferenceIds.includes(asset.id)),
    [referenceAssets, selectedReferenceIds],
  );
  const isBusy = isLoading || isSubmitting || Boolean(activeTaskId);
  const canSubmit = Boolean(
    projectId && prompt.trim().length > 0 && selectedReferenceIds.length > 0 && !isBusy,
  );

  function toggleReferenceAsset(assetId: string) {
    setSelectedReferenceIds((current) =>
      current.includes(assetId)
        ? current.filter((value) => value !== assetId)
        : [...current, assetId],
    );
  }

  async function submit() {
    if (!projectId) {
      setError("Missing projectId");
      return;
    }

    const submitRouteProjectId = latestRouteProjectIdRef.current;
    const submitRequestId = (submitRequestSeq.current += 1);
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt) {
      setError("Enter a prompt before generating a video");
      return;
    }

    if (selectedReferenceIds.length === 0) {
      setError("Select at least one reference image");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setStatusMessage(null);

    try {
      const response = await fetch("/api/videos", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          projectId,
          prompt: trimmedPrompt,
          referenceAssetIds: selectedReferenceIds,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { taskId?: string; error?: string }
        | null;

      if (!response.ok || !payload?.taskId) {
        throw new Error(payload?.error ?? "Failed to enqueue video task");
      }

      if (latestRouteProjectIdRef.current !== submitRouteProjectId) {
        return;
      }

      setActiveTaskId(payload.taskId);
      setStatusMessage("Video task queued.");
    } catch (submitError) {
      if (latestRouteProjectIdRef.current !== submitRouteProjectId) {
        return;
      }

      setStatusMessage(null);
      setError(submitError instanceof Error ? submitError.message : "Failed to enqueue video task");
    } finally {
      if (
        submitRequestId === submitRequestSeq.current &&
        latestRouteProjectIdRef.current === submitRouteProjectId
      ) {
        setIsSubmitting(false);
      }
    }
  }

  return (
    <section style={pageStyle}>
      <header style={heroStyle}>
        <div style={heroContentStyle}>
          <p style={eyebrowStyle}>Video Workflow</p>
          <h2 style={heroTitleStyle}>
            {isLoading ? "Loading project..." : workspace?.project.title ?? "Videos"}
          </h2>
          <p style={heroCopyStyle}>
            Animate storyboard stills and project images into short clips using project-scoped
            reference assets only.
          </p>
        </div>
        <div style={actionsStyle}>
          <Link href={`/projects/${projectId}`} style={secondaryLinkStyle}>
            Back to project
          </Link>
        </div>
      </header>

      <article style={cardStyle}>
        <h3 style={sectionTitleStyle}>Generate</h3>
        <div style={fieldGroupStyle}>
          <label style={labelStyle} htmlFor="videoPromptInput">
            Prompt
          </label>
          <textarea
            id="videoPromptInput"
            aria-label="Video prompt input"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={isBusy}
            placeholder="Describe the camera motion, subject movement, and timing..."
            style={textareaStyle}
            rows={5}
          />
        </div>

        <div style={fieldGroupStyle}>
          <p style={labelStyle}>Reference images</p>
          <p style={helperStyle}>
            Select one or more image assets from this project. The API only accepts existing
            `referenceAssetIds`; it does not upload files here.
          </p>

          {referenceAssets.length === 0 ? (
            <p style={emptyStyle}>No image assets are available for this project yet.</p>
          ) : (
            <div style={referenceGridStyle}>
              {referenceAssets.map((asset) => {
                const selected = selectedReferenceIds.includes(asset.id);

                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => toggleReferenceAsset(asset.id)}
                    disabled={isBusy}
                    style={selected ? referenceCardSelectedStyle : referenceCardStyle}
                  >
                    {asset.previewDataUrl ? (
                      <Image
                        src={asset.previewDataUrl}
                        alt={`Reference ${asset.id}`}
                        width={240}
                        height={150}
                        unoptimized
                        style={referenceImageStyle}
                      />
                    ) : (
                      <div style={referencePlaceholderStyle}>Preview unavailable</div>
                    )}
                    <span style={referenceMetaStyle}>
                      {asset.id}
                      <br />
                      {asset.kind} · {Math.round(asset.sizeBytes / 1024)} KB
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {selectedReferences.length > 0 ? (
          <p style={helperStyle}>Selected references: {selectedReferences.length}</p>
        ) : null}

        <div style={submitRowStyle}>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            style={primaryButtonStyle}
          >
            Generate video
          </button>
          {activeTaskId ? <span style={metaStyle}>Task: {activeTaskId}</span> : null}
        </div>

        {statusMessage ? <p style={statusStyle}>{statusMessage}</p> : null}
        {error ? <p style={errorStyle}>{error}</p> : null}
      </article>

      <div style={twoColumnStyle}>
        <article style={cardStyle}>
          <h3 style={sectionTitleStyle}>Task Progress</h3>
          {activeTaskId ? (
            <div style={taskCardStyle}>
              <strong>{activeTaskId}</strong>
              <span style={taskMetaStyle}>Status: {task?.status ?? "QUEUED"}</span>
            </div>
          ) : (
            <p style={emptyStyle}>No video task is currently running.</p>
          )}

          {recentTasks.length > 0 ? (
            <div style={taskListStyle}>
              {recentTasks.map((taskItem) => (
                <div key={taskItem.id} style={taskCardStyle}>
                  <strong>{taskItem.id}</strong>
                  <span style={taskMetaStyle}>
                    {taskItem.status} · {new Date(taskItem.createdAt).toLocaleString()}
                  </span>
                  {taskItem.errorText ? <span style={taskErrorStyle}>{taskItem.errorText}</span> : null}
                </div>
              ))}
            </div>
          ) : null}
        </article>

        <article style={cardStyle}>
          <h3 style={sectionTitleStyle}>Generated Videos</h3>
          {videoAssets.length === 0 ? (
            <p style={emptyStyle}>No generated videos recorded for this project yet.</p>
          ) : (
            <div style={videoGridStyle}>
              {videoAssets.map((asset) => (
                <figure key={asset.id} style={videoCardStyle}>
                  {asset.previewDataUrl ? (
                    <video controls preload="metadata" style={videoPreviewStyle} src={asset.previewDataUrl} />
                  ) : (
                    <div style={videoPlaceholderStyle}>Preview unavailable</div>
                  )}
                  <figcaption style={assetCaptionStyle}>
                    <strong style={assetIdStyle}>{asset.id}</strong>
                    <span style={assetMetaStyle}>
                      {asset.mimeType} · {Math.round(asset.sizeBytes / 1024)} KB
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </article>
      </div>
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
  alignItems: "flex-start",
  gap: "16px",
  padding: "24px",
  borderRadius: "24px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
  background: "rgba(255, 250, 243, 0.92)",
} satisfies CSSProperties;

const heroContentStyle = {
  display: "grid",
  gap: "10px",
  maxWidth: "760px",
} satisfies CSSProperties;

const eyebrowStyle = {
  margin: 0,
  color: "#8c5f2d",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  fontSize: "0.8rem",
} satisfies CSSProperties;

const heroTitleStyle = {
  margin: 0,
  fontSize: "2rem",
} satisfies CSSProperties;

const heroCopyStyle = {
  margin: 0,
  color: "#665d52",
  lineHeight: 1.6,
} satisfies CSSProperties;

const actionsStyle = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
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

const cardStyle = {
  display: "grid",
  gap: "14px",
  padding: "20px",
  borderRadius: "24px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
  background: "rgba(255, 250, 243, 0.88)",
} satisfies CSSProperties;

const sectionTitleStyle = {
  margin: 0,
  fontSize: "1.1rem",
} satisfies CSSProperties;

const fieldGroupStyle = {
  display: "grid",
  gap: "8px",
} satisfies CSSProperties;

const labelStyle = {
  margin: 0,
  fontWeight: 700,
  color: "#4b3a27",
} satisfies CSSProperties;

const textareaStyle = {
  padding: "10px 12px",
  borderRadius: "12px",
  border: "1px solid rgba(31, 27, 22, 0.18)",
  background: "#fff",
  color: "#1f1b16",
  resize: "vertical",
  minHeight: "120px",
} satisfies CSSProperties;

const helperStyle = {
  margin: 0,
  color: "#665d52",
  fontSize: "0.9rem",
  lineHeight: 1.5,
} satisfies CSSProperties;

const referenceGridStyle = {
  display: "grid",
  gap: "12px",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
} satisfies CSSProperties;

const referenceCardStyle = {
  display: "grid",
  gap: "8px",
  padding: "10px",
  borderRadius: "18px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
  background: "#fff",
  cursor: "pointer",
  textAlign: "left",
} satisfies CSSProperties;

const referenceCardSelectedStyle = {
  ...referenceCardStyle,
  border: "1px solid rgba(140, 95, 45, 0.8)",
  boxShadow: "0 0 0 2px rgba(140, 95, 45, 0.14)",
} satisfies CSSProperties;

const referenceImageStyle = {
  width: "100%",
  height: "150px",
  objectFit: "cover",
  borderRadius: "14px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
} satisfies CSSProperties;

const referencePlaceholderStyle = {
  width: "100%",
  height: "150px",
  display: "grid",
  placeItems: "center",
  borderRadius: "14px",
  border: "1px dashed rgba(31, 27, 22, 0.2)",
  color: "#665d52",
  background: "rgba(255, 250, 243, 0.7)",
} satisfies CSSProperties;

const referenceMetaStyle = {
  color: "#4b3a27",
  fontSize: "0.9rem",
  wordBreak: "break-word",
  lineHeight: 1.5,
} satisfies CSSProperties;

const submitRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  flexWrap: "wrap",
} satisfies CSSProperties;

const primaryButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "999px",
  padding: "12px 18px",
  border: "none",
  background: "#8c5f2d",
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer",
} satisfies CSSProperties;

const metaStyle = {
  color: "#665d52",
  fontSize: "0.9rem",
} satisfies CSSProperties;

const statusStyle = {
  margin: 0,
  color: "#245f3f",
  fontWeight: 700,
} satisfies CSSProperties;

const errorStyle = {
  margin: 0,
  color: "#a11d1d",
  fontWeight: 700,
} satisfies CSSProperties;

const emptyStyle = {
  margin: 0,
  color: "#665d52",
  lineHeight: 1.6,
} satisfies CSSProperties;

const twoColumnStyle = {
  display: "grid",
  gap: "20px",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
} satisfies CSSProperties;

const taskListStyle = {
  display: "grid",
  gap: "10px",
} satisfies CSSProperties;

const taskCardStyle = {
  display: "grid",
  gap: "4px",
  padding: "14px",
  borderRadius: "18px",
  border: "1px solid rgba(31, 27, 22, 0.1)",
  background: "rgba(255, 255, 255, 0.7)",
} satisfies CSSProperties;

const taskMetaStyle = {
  color: "#665d52",
  fontSize: "0.9rem",
} satisfies CSSProperties;

const taskErrorStyle = {
  color: "#a11d1d",
  fontSize: "0.85rem",
} satisfies CSSProperties;

const videoGridStyle = {
  display: "grid",
  gap: "14px",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
} satisfies CSSProperties;

const videoCardStyle = {
  margin: 0,
  display: "grid",
  gap: "10px",
  padding: "14px",
  borderRadius: "20px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
  background: "rgba(255, 255, 255, 0.7)",
} satisfies CSSProperties;

const videoPreviewStyle = {
  width: "100%",
  height: "220px",
  borderRadius: "14px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
  background: "#000",
  objectFit: "cover",
} satisfies CSSProperties;

const videoPlaceholderStyle = {
  width: "100%",
  height: "220px",
  display: "grid",
  placeItems: "center",
  borderRadius: "14px",
  border: "1px dashed rgba(31, 27, 22, 0.2)",
  color: "#665d52",
  background: "rgba(255, 250, 243, 0.7)",
} satisfies CSSProperties;

const assetCaptionStyle = {
  display: "grid",
  gap: "4px",
} satisfies CSSProperties;

const assetIdStyle = {
  color: "#1f1b16",
  fontSize: "0.95rem",
  wordBreak: "break-word",
} satisfies CSSProperties;

const assetMetaStyle = {
  color: "#665d52",
  fontSize: "0.85rem",
} satisfies CSSProperties;
