"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import useTaskPolling from "@/hooks/useTaskPolling";

type ImageAssetSummary = {
  id: string;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  taskId?: string | null;
  createdAt: string;
  previewDataUrl?: string | null;
};

type ImagesWorkspaceResponse = {
  project: {
    id: string;
    title: string;
    idea?: string | null;
  };
  maxUploadMb: number;
  assets: ImageAssetSummary[];
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

type Mode = "text" | "image";

const EMPTY_ASSETS: ImageAssetSummary[] = [];

function getMaxUploadBytes(maxUploadMb: number) {
  const parsed = Number(maxUploadMb);
  const effective = Number.isFinite(parsed) && parsed > 0 ? parsed : 25;
  return Math.floor(effective * 1024 * 1024);
}

export default function ProjectImagesPage() {
  const params = useParams<{ projectId: string }>();
  const routeProjectId = params.projectId ?? "";
  const latestRouteProjectIdRef = useRef(routeProjectId);
  latestRouteProjectIdRef.current = routeProjectId;
  const [projectId, setProjectId] = useState("");
  const [workspace, setWorkspace] = useState<ImagesWorkspaceResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("text");
  const [prompt, setPrompt] = useState("");
  const [sourceAssetId, setSourceAssetId] = useState<string>("");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { task, error: pollingError } = useTaskPolling(activeTaskId);
  const workspaceRequestSeq = useRef(0);

  useEffect(() => {
    setProjectId(params.projectId ?? "");
  }, [params]);

  async function reloadWorkspace(nextProjectId: string): Promise<boolean> {
    // Bump request id so slower earlier responses cannot overwrite newer state.
    const requestId = (workspaceRequestSeq.current += 1);

    try {
      const response = await fetch(`/api/images?projectId=${encodeURIComponent(nextProjectId)}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | ImagesWorkspaceResponse
        | { error?: string }
        | null;

      if (!response.ok || !payload || !("project" in payload)) {
        // Ignore failures from stale requests.
        if (requestId !== workspaceRequestSeq.current) {
          return false;
        }

        throw new Error(
          payload && "error" in payload
            ? payload.error ?? "Failed to load images"
            : "Failed to load images",
        );
      }

      // Ignore responses that are no longer the latest request.
      if (requestId !== workspaceRequestSeq.current) {
        return false;
      }

      setWorkspace(payload);
      return true;
    } catch (error) {
      // Ignore failures from stale requests.
      if (requestId !== workspaceRequestSeq.current) {
        return false;
      }

      throw error;
    }
  }

  useEffect(() => {
    if (!projectId) {
      return;
    }

    let cancelled = false;

    async function load() {
      setIsLoading(true);
      // Project-scoped state must not linger across navigation while the new workspace loads.
      setWorkspace(null);
      setActiveTaskId(null);
      setStatusMessage(null);
      setError(null);
      setIsSubmitting(false);
      setSourceAssetId("");

      try {
        const applied = await reloadWorkspace(projectId);

        if (!cancelled && applied) {
          setSourceAssetId("");
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load images");
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
      setStatusMessage("Generating image...");
      setError(null);
      return;
    }

    if (polledTask.status === "SUCCEEDED") {
      setError(null);
      setActiveTaskId(null);

      if (!projectId) {
        setStatusMessage("Image generated.");
        return;
      }

      setStatusMessage("Refreshing results...");

      void (async () => {
        try {
          const applied = await reloadWorkspace(projectId);
          if (!applied) {
            return;
          }
          setStatusMessage("Image generated.");
        } catch (refreshError) {
          setStatusMessage(null);
          const message =
            refreshError instanceof Error
              ? refreshError.message
              : "Failed to load images";
          setError(`Image generated, but failed to refresh results: ${message}`);
        }
      })();
      return;
    }

    if (polledTask.status === "FAILED" || polledTask.status === "CANCELED") {
      setStatusMessage(null);
      setError(polledTask.errorText ?? "Image generation failed");
      setActiveTaskId(null);
    }
  }, [activeTaskId, projectId, task]);

  const maxUploadBytes = getMaxUploadBytes(workspace?.maxUploadMb ?? 25);
  const assets = workspace?.assets ?? EMPTY_ASSETS;

  const selectableAssets = useMemo(() => {
    return assets.filter((asset) => asset.mimeType.startsWith("image/"));
  }, [assets]);

  const selectedAsset = useMemo(() => {
    if (!sourceAssetId) {
      return null;
    }

    return selectableAssets.find((asset) => asset.id === sourceAssetId) ?? null;
  }, [selectableAssets, sourceAssetId]);

  const isBusy = isLoading || isSubmitting || Boolean(activeTaskId);
  const canSubmit = Boolean(projectId && prompt.trim().length > 0 && !isBusy);

  async function submit() {
    if (!projectId) {
      setError("Missing projectId");
      return;
    }

    const submitRouteProjectId = latestRouteProjectIdRef.current;
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setError("Enter a prompt before generating an image");
      return;
    }

    if (mode === "image") {
      if (!sourceAssetId) {
        setError("Select a reference image asset");
        return;
      }

      if (selectedAsset && selectedAsset.sizeBytes > maxUploadBytes) {
        setError(`Reference image exceeds MAX_UPLOAD_MB (${workspace?.maxUploadMb ?? 25} MB)`);
        return;
      }
    }

    setIsSubmitting(true);
    setError(null);
    setStatusMessage(null);

    try {
      const form = new FormData();
      form.set("projectId", projectId);
      form.set("prompt", trimmedPrompt);
      if (mode === "image") {
        form.set("sourceAssetId", sourceAssetId);
      }

      const response = await fetch("/api/images", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json().catch(() => null)) as
        | { taskId?: string; error?: string }
        | null;

      if (response.status === 413) {
        throw new Error(payload?.error ?? "Payload Too Large");
      }

      if (!response.ok || !payload?.taskId) {
        throw new Error(payload?.error ?? "Failed to enqueue image task");
      }

      // Suppress late enqueue responses after navigation.
      if (latestRouteProjectIdRef.current !== submitRouteProjectId) {
        return;
      }

      setActiveTaskId(payload.taskId);
      setStatusMessage("Image task queued.");
    } catch (submitError) {
      // Suppress late enqueue failures after navigation.
      if (latestRouteProjectIdRef.current !== submitRouteProjectId) {
        return;
      }

      setStatusMessage(null);
      setError(submitError instanceof Error ? submitError.message : "Failed to enqueue image task");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section style={pageStyle}>
      <header style={heroStyle}>
        <div style={heroContentStyle}>
          <p style={eyebrowStyle}>Images Workflow</p>
          <h2 style={heroTitleStyle}>
            {isLoading ? "Loading project..." : workspace?.project.title ?? "Images"}
          </h2>
          <p style={heroCopyStyle}>
            Generate images from text prompts, or transform an existing project image with a prompt.
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
        <div style={modeRowStyle}>
          <button
            type="button"
            onClick={() => setMode("text")}
            disabled={isBusy}
            style={mode === "text" ? modeButtonActiveStyle : modeButtonStyle}
          >
            Text-to-image
          </button>
          <button
            type="button"
            onClick={() => setMode("image")}
            disabled={isBusy}
            style={mode === "image" ? modeButtonActiveStyle : modeButtonStyle}
          >
            Switch to image-to-image
          </button>
        </div>

        {mode === "image" ? (
          <div style={fieldGroupStyle}>
            <label style={labelStyle} htmlFor="sourceAssetId">
              Reference image asset
            </label>
            <select
              id="sourceAssetId"
              value={sourceAssetId}
              onChange={(event) => setSourceAssetId(event.target.value)}
              disabled={isBusy}
              style={inputStyle}
            >
              <option value="">Select an image asset...</option>
              {selectableAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.id} ({Math.round(asset.sizeBytes / 1024)} KB)
                </option>
              ))}
            </select>
            {selectedAsset?.previewDataUrl ? (
              <figure style={previewFigureStyle}>
                <Image
                  src={selectedAsset.previewDataUrl}
                  alt="Reference preview"
                  width={420}
                  height={220}
                  unoptimized
                  style={previewImageStyle}
                />
              </figure>
            ) : null}
          </div>
        ) : null}

        <div style={fieldGroupStyle}>
          <label style={labelStyle} htmlFor="promptInput">
            Prompt
          </label>
          <textarea
            id="promptInput"
            aria-label="Image prompt input"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={isBusy}
            placeholder="Describe the image you want..."
            style={textareaStyle}
            rows={4}
          />
          <p style={helperStyle}>MAX_UPLOAD_MB: {workspace?.maxUploadMb ?? 25} MB</p>
        </div>

        <div style={submitRowStyle}>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            style={primaryButtonStyle}
          >
            Generate image
          </button>
          {activeTaskId ? (
            <span style={metaStyle}>Task: {activeTaskId}</span>
          ) : null}
        </div>

        {statusMessage ? <p style={statusStyle}>{statusMessage}</p> : null}
        {error ? <p style={errorStyle}>{error}</p> : null}
      </article>

      <article style={cardStyle}>
        <h3 style={sectionTitleStyle}>Results</h3>
        {assets.length === 0 ? (
          <p style={emptyStyle}>No image assets recorded for this project yet.</p>
        ) : (
          <div style={assetGridStyle}>
            {assets.map((asset) => (
              <figure key={asset.id} style={assetCardStyle}>
                {asset.previewDataUrl ? (
                  <Image
                    src={asset.previewDataUrl}
                    alt={`Asset ${asset.id}`}
                    width={320}
                    height={180}
                    unoptimized
                    style={assetImageStyle}
                  />
                ) : (
                  <div style={assetPlaceholderStyle}>
                    <span style={placeholderTextStyle}>Preview unavailable</span>
                  </div>
                )}
                <figcaption style={assetCaptionStyle}>
                  <strong style={assetIdStyle}>{asset.id}</strong>
                  <span style={assetMetaStyle}>
                    {asset.mimeType} - {Math.round(asset.sizeBytes / 1024)} KB
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </article>
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

const modeRowStyle = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
} satisfies CSSProperties;

const modeButtonStyle = {
  ...secondaryLinkStyle,
  border: "1px solid rgba(140, 95, 45, 0.25)",
} satisfies CSSProperties;

const modeButtonActiveStyle = {
  ...primaryButtonStyle,
} satisfies CSSProperties;

const fieldGroupStyle = {
  display: "grid",
  gap: "8px",
} satisfies CSSProperties;

const labelStyle = {
  fontWeight: 700,
  color: "#4b3a27",
} satisfies CSSProperties;

const inputStyle = {
  padding: "10px 12px",
  borderRadius: "12px",
  border: "1px solid rgba(31, 27, 22, 0.18)",
  background: "#fff",
  color: "#1f1b16",
} satisfies CSSProperties;

const textareaStyle = {
  ...inputStyle,
  resize: "vertical",
  minHeight: "100px",
} satisfies CSSProperties;

const helperStyle = {
  margin: 0,
  color: "#665d52",
  fontSize: "0.9rem",
  lineHeight: 1.5,
} satisfies CSSProperties;

const submitRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  flexWrap: "wrap",
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

const assetGridStyle = {
  display: "grid",
  gap: "14px",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
} satisfies CSSProperties;

const assetCardStyle = {
  margin: 0,
  display: "grid",
  gap: "10px",
  padding: "14px",
  borderRadius: "20px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
  background: "rgba(255, 255, 255, 0.7)",
} satisfies CSSProperties;

const assetImageStyle = {
  width: "100%",
  height: "180px",
  objectFit: "cover",
  borderRadius: "14px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
} satisfies CSSProperties;

const assetPlaceholderStyle = {
  width: "100%",
  height: "180px",
  borderRadius: "14px",
  border: "1px dashed rgba(31, 27, 22, 0.22)",
  background: "rgba(255, 250, 243, 0.65)",
  display: "grid",
  placeItems: "center",
} satisfies CSSProperties;

const placeholderTextStyle = {
  color: "#665d52",
  fontSize: "0.95rem",
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

const previewFigureStyle = {
  margin: 0,
} satisfies CSSProperties;

const previewImageStyle = {
  width: "100%",
  maxWidth: "420px",
  height: "220px",
  objectFit: "cover",
  borderRadius: "18px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
} satisfies CSSProperties;
