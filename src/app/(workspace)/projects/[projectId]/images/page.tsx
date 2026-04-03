"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import PageHero from "@/components/studio/page-hero";
import StatusBadge from "@/components/studio/status-badge";
import WorkflowRail from "@/components/studio/workflow-rail";
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

const copy = {
  workflowTitle: "项目制作流程",
  stageTitle: "图片",
  stageDescription: "根据分镜提示生成关键画面，或者基于当前项目已有图片继续做图生图调整。",
  projectLabel: "当前项目",
  backToProject: "返回项目制作台",
  activeStage: "当前阶段",
  noIdea: "项目还没有补充创意说明，先确认分镜方向再继续出图。",
  scriptStage: "脚本",
  storyboardStage: "分镜",
  imagesStage: "图片",
  videosStage: "视频",
  stageDone: "已完成",
  stageActive: "进行中",
  stageNext: "下一步",
  stageWaiting: "待开始",
  generateHeading: "生成设置",
  generateDescription: "文本生图和图生图共用同一套任务链路，只是输入的素材来源不同。",
  resultHeading: "结果列表",
  resultDescription: "所有图片结果都按项目归档在这里，方便后续进入视频阶段继续使用。",
  textMode: "文生图",
  imageMode: "图生图",
  referenceAssetLabel: "参考图片",
  promptLabel: "生成提示词",
  promptPlaceholder: "描述你想生成的画面...",
  helperPrefix: "MAX_UPLOAD_MB：",
  noAssets: "当前项目还没有图片资产。",
  noReferenceAssets: "请先生成一张图片，再继续图生图。",
  selectReference: "选择一张项目内图片作为参考",
  referencePlaceholder: "选择图片资产...",
  previewUnavailable: "暂无预览",
  loadingProject: "加载项目中...",
  generating: "Generating image...",
  generated: "Image generated.",
  requestQueued: "Image task queued.",
  failed: "Image generation failed",
  refreshFailedPrefix: "Image generated, but failed to refresh results: ",
  missingProjectId: "Missing projectId",
  enterPrompt: "Enter a prompt before generating an image",
  selectReferenceValidation: "Select a reference image asset",
  uploadTooLargePrefix: "Reference image exceeds MAX_UPLOAD_MB (",
  uploadTooLargeSuffix: " MB)",
  enqueueFailed: "Failed to enqueue image task",
  payloadTooLarge: "Payload Too Large",
  scriptDetail: "脚本定稿后继续把镜头拆成画面指令。",
  storyboardDetail: "分镜完成后可把镜头提示转成关键画面。",
  imagesDetail: "当前页负责管理文生图和图生图结果。",
  videosDetail: "选中满意的图片后继续生成视频。",
  enterScript: "前往脚本",
  enterStoryboard: "前往分镜",
  enterImages: "继续图片",
  enterVideos: "前往视频",
} as const;

function getMaxUploadBytes(maxUploadMb: number) {
  const parsed = Number(maxUploadMb);
  const effective = Number.isFinite(parsed) && parsed > 0 ? parsed : 25;
  return Math.floor(effective * 1024 * 1024);
}

function formatAssetMeta(asset: ImageAssetSummary) {
  return `${asset.mimeType} · ${Math.round(asset.sizeBytes / 1024)} KB`;
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
  const submitRequestSeq = useRef(0);

  useEffect(() => {
    setProjectId(params.projectId ?? "");
  }, [params]);

  async function reloadWorkspace(nextProjectId: string): Promise<boolean> {
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
        if (requestId !== workspaceRequestSeq.current) {
          return false;
        }

        throw new Error(
          payload && "error" in payload
            ? payload.error ?? "Failed to load images"
            : "Failed to load images",
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
      setStatusMessage(copy.generating);
      setError(null);
      return;
    }

    if (polledTask.status === "SUCCEEDED") {
      setError(null);
      setActiveTaskId(null);

      if (!projectId) {
        setStatusMessage(copy.generated);
        return;
      }

      setStatusMessage("Refreshing results...");

      void (async () => {
        try {
          const applied = await reloadWorkspace(projectId);
          if (!applied) {
            return;
          }
          setStatusMessage(copy.generated);
        } catch (refreshError) {
          setStatusMessage(null);
          const message =
            refreshError instanceof Error
              ? refreshError.message
              : "Failed to load images";
          setError(`${copy.refreshFailedPrefix}${message}`);
        }
      })();
      return;
    }

    if (polledTask.status === "FAILED" || polledTask.status === "CANCELED") {
      setStatusMessage(null);
      setError(polledTask.errorText ?? copy.failed);
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
      setError(copy.missingProjectId);
      return;
    }

    const submitRouteProjectId = latestRouteProjectIdRef.current;
    const submitRequestId = (submitRequestSeq.current += 1);
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setError(copy.enterPrompt);
      return;
    }

    if (mode === "image") {
      if (!sourceAssetId) {
        setError(copy.selectReferenceValidation);
        return;
      }

      if (selectedAsset && selectedAsset.sizeBytes > maxUploadBytes) {
        setError(
          `${copy.uploadTooLargePrefix}${workspace?.maxUploadMb ?? 25}${copy.uploadTooLargeSuffix}`,
        );
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
        throw new Error(payload?.error ?? copy.payloadTooLarge);
      }

      if (!response.ok || !payload?.taskId) {
        throw new Error(payload?.error ?? copy.enqueueFailed);
      }

      if (latestRouteProjectIdRef.current !== submitRouteProjectId) {
        return;
      }

      setActiveTaskId(payload.taskId);
      setStatusMessage(copy.requestQueued);
    } catch (submitError) {
      if (latestRouteProjectIdRef.current !== submitRouteProjectId) {
        return;
      }

      setStatusMessage(null);
      setError(submitError instanceof Error ? submitError.message : copy.enqueueFailed);
    } finally {
      if (
        submitRequestId === submitRequestSeq.current &&
        latestRouteProjectIdRef.current === submitRouteProjectId
      ) {
        setIsSubmitting(false);
      }
    }
  }

  const projectSummary = workspace?.project.idea?.trim() || copy.noIdea;

  return (
    <div style={pageStyle}>
      <PageHero
        eyebrow={copy.workflowTitle}
        title={copy.stageTitle}
        description={copy.stageDescription}
        actions={
          <Link href={`/projects/${projectId}`} style={secondaryActionStyle}>
            {copy.backToProject}
          </Link>
        }
        supportingContent={
          <div style={heroSupportStyle}>
            <div style={heroSupportHeaderStyle}>
              <span style={heroMetaLabelStyle}>{copy.projectLabel}</span>
              <StatusBadge label={copy.activeStage} tone="active" />
            </div>
            <h2 style={heroSupportTitleStyle}>
              {isLoading ? copy.loadingProject : workspace?.project.title ?? copy.loadingProject}
            </h2>
            <p style={heroSupportBodyStyle}>{projectSummary}</p>
          </div>
        }
      />

      <WorkflowRail
        title={copy.workflowTitle}
        layout="cards"
        items={[
          {
            label: copy.scriptStage,
            detail: copy.scriptDetail,
            summary: "保留剧本定稿内容，作为后续分镜输入。",
            badgeLabel: copy.stageDone,
            tone: "active",
            href: `/projects/${projectId}/script`,
            ctaLabel: copy.enterScript,
          },
          {
            label: copy.storyboardStage,
            detail: copy.storyboardDetail,
            summary: "按 15 秒段落拆出镜头和视频提示词。",
            badgeLabel: copy.stageDone,
            tone: "active",
            href: `/projects/${projectId}/storyboard`,
            ctaLabel: copy.enterStoryboard,
          },
          {
            label: copy.imagesStage,
            detail: assets.length
              ? `当前已归档 ${assets.length} 张项目图片。`
              : copy.imagesDetail,
            summary:
              mode === "image"
                ? "图生图会复用项目内已有图片作为输入。"
                : "文生图和图生图都走同一套任务接口。",
            badgeLabel: copy.stageActive,
            tone: "active",
            href: `/projects/${projectId}/images`,
            ctaLabel: copy.enterImages,
          },
          {
            label: copy.videosStage,
            detail: copy.videosDetail,
            summary: assets.length
              ? "已经有可选图片，可继续进入视频阶段。"
              : "等待先生成关键画面。",
            badgeLabel: assets.length ? copy.stageNext : copy.stageWaiting,
            tone: assets.length ? "warning" : "neutral",
            href: `/projects/${projectId}/videos`,
            ctaLabel: copy.enterVideos,
          },
        ]}
      />

      {statusMessage ? (
        <p role="status" style={statusNoticeStyle}>
          {statusMessage}
        </p>
      ) : null}
      {error ? (
        <p role="alert" style={errorNoticeStyle}>
          {error}
        </p>
      ) : null}

      <section style={panelStyle}>
        <div style={sectionHeaderStyle}>
          <h2 style={sectionTitleStyle}>{copy.generateHeading}</h2>
          <p style={sectionDescriptionStyle}>{copy.generateDescription}</p>
        </div>

        <div style={buttonRowStyle}>
          <button
            type="button"
            onClick={() => setMode("text")}
            disabled={isBusy}
            style={mode === "text" ? primaryButtonStyle : secondaryButtonStyle}
          >
            {copy.textMode}
          </button>
          <button
            type="button"
            aria-label="Switch to image-to-image"
            onClick={() => setMode("image")}
            disabled={isBusy}
            style={mode === "image" ? primaryButtonStyle : secondaryButtonStyle}
          >
            {copy.imageMode}
          </button>
        </div>

        {mode === "image" ? (
          <div style={fieldGridStyle}>
            <label style={fieldStyle} htmlFor="sourceAssetId">
              <span style={fieldLabelStyle}>{copy.referenceAssetLabel}</span>
              <select
                id="sourceAssetId"
                aria-label="Reference image asset"
                value={sourceAssetId}
                onChange={(event) => setSourceAssetId(event.target.value)}
                disabled={isBusy}
                style={selectStyle}
              >
                <option value="">{copy.referencePlaceholder}</option>
                {selectableAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.id} ({Math.round(asset.sizeBytes / 1024)} KB)
                  </option>
                ))}
              </select>
            </label>
            <p style={helperStyle}>
              {selectableAssets.length === 0 ? copy.noReferenceAssets : copy.selectReference}
            </p>
            {selectedAsset?.previewDataUrl ? (
              <figure style={referencePreviewStyle}>
                <Image
                  src={selectedAsset.previewDataUrl}
                  alt="Reference preview"
                  width={420}
                  height={220}
                  unoptimized
                  style={referencePreviewImageStyle}
                />
              </figure>
            ) : null}
          </div>
        ) : null}

        <div style={fieldGridStyle}>
          <label style={fieldStyle} htmlFor="promptInput">
            <span style={fieldLabelStyle}>{copy.promptLabel}</span>
            <textarea
              id="promptInput"
              aria-label="Image prompt input"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              disabled={isBusy}
              placeholder={copy.promptPlaceholder}
              style={textareaStyle}
              rows={4}
            />
          </label>
          <p style={helperStyle}>
            {copy.helperPrefix}
            {workspace?.maxUploadMb ?? 25} MB
          </p>
        </div>

        <div style={buttonRowStyle}>
          <button
            type="button"
            aria-label="Generate image"
            onClick={() => void submit()}
            disabled={!canSubmit}
            style={primaryButtonStyle}
          >
            生成图片
          </button>
          {activeTaskId ? <span style={metaTextStyle}>Task: {activeTaskId}</span> : null}
        </div>
      </section>

      <section style={panelStyle}>
        <div style={sectionHeaderStyle}>
          <h2 style={sectionTitleStyle}>{copy.resultHeading}</h2>
          <p style={sectionDescriptionStyle}>{copy.resultDescription}</p>
        </div>
        {assets.length === 0 ? (
          <p style={emptyStateStyle}>{copy.noAssets}</p>
        ) : (
          <div style={assetGridStyle}>
            {assets.map((asset) => (
              <article key={asset.id} style={assetCardStyle}>
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
                  <div style={assetPlaceholderStyle}>{copy.previewUnavailable}</div>
                )}
                <div style={assetCopyStyle}>
                  <strong style={assetTitleStyle}>{asset.id}</strong>
                  <span style={assetMetaStyle}>{formatAssetMeta(asset)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const pageStyle = {
  display: "grid",
  gap: "24px",
} satisfies CSSProperties;

const heroSupportStyle = {
  display: "grid",
  gap: "10px",
} satisfies CSSProperties;

const heroSupportHeaderStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  flexWrap: "wrap",
} satisfies CSSProperties;

const heroMetaLabelStyle = {
  color: "var(--text-muted)",
  fontSize: "0.82rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
} satisfies CSSProperties;

const heroSupportTitleStyle = {
  margin: 0,
  fontSize: "1.15rem",
  lineHeight: 1.4,
} satisfies CSSProperties;

const heroSupportBodyStyle = {
  margin: 0,
  color: "var(--text-muted)",
  lineHeight: 1.7,
} satisfies CSSProperties;

const secondaryActionStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "42px",
  padding: "0 18px",
  borderRadius: "999px",
  background: "rgba(248, 250, 252, 0.08)",
  border: "1px solid rgba(248, 250, 252, 0.12)",
  color: "var(--text)",
  textDecoration: "none",
  fontWeight: 700,
} satisfies CSSProperties;

const panelStyle = {
  display: "grid",
  gap: "16px",
  padding: "22px",
  borderRadius: "24px",
  border: "1px solid var(--border)",
  background: "rgba(22, 24, 39, 0.88)",
  boxShadow: "var(--shadow-panel)",
} satisfies CSSProperties;

const sectionHeaderStyle = {
  display: "grid",
  gap: "8px",
} satisfies CSSProperties;

const sectionTitleStyle = {
  margin: 0,
  fontSize: "1.2rem",
} satisfies CSSProperties;

const sectionDescriptionStyle = {
  margin: 0,
  color: "var(--text-muted)",
  lineHeight: 1.6,
} satisfies CSSProperties;

const statusNoticeStyle = {
  margin: 0,
  padding: "16px 18px",
  borderRadius: "18px",
  border: "1px solid rgba(74, 222, 128, 0.2)",
  background: "rgba(21, 128, 61, 0.16)",
  color: "#dcfce7",
  lineHeight: 1.6,
} satisfies CSSProperties;

const errorNoticeStyle = {
  margin: 0,
  padding: "16px 18px",
  borderRadius: "18px",
  border: "1px solid rgba(248, 113, 113, 0.24)",
  background: "rgba(127, 29, 29, 0.24)",
  color: "#fecaca",
  lineHeight: 1.6,
} satisfies CSSProperties;

const buttonRowStyle = {
  display: "flex",
  gap: "12px",
  flexWrap: "wrap",
  alignItems: "center",
} satisfies CSSProperties;

const primaryButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "42px",
  padding: "0 18px",
  borderRadius: "999px",
  border: 0,
  background:
    "linear-gradient(135deg, rgba(109, 94, 252, 0.95), rgba(129, 140, 248, 0.72))",
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer",
} satisfies CSSProperties;

const secondaryButtonStyle = {
  ...primaryButtonStyle,
  background: "rgba(248, 250, 252, 0.08)",
  border: "1px solid rgba(248, 250, 252, 0.12)",
  color: "var(--text)",
} satisfies CSSProperties;

const fieldGridStyle = {
  display: "grid",
  gap: "12px",
} satisfies CSSProperties;

const fieldStyle = {
  display: "grid",
  gap: "8px",
} satisfies CSSProperties;

const fieldLabelStyle = {
  fontWeight: 700,
  color: "var(--text)",
} satisfies CSSProperties;

const selectStyle = {
  width: "100%",
  minHeight: "48px",
  borderRadius: "18px",
  border: "1px solid rgba(129, 140, 248, 0.2)",
  padding: "0 14px",
  color: "var(--text)",
  background: "rgba(8, 10, 26, 0.4)",
} satisfies CSSProperties;

const textareaStyle = {
  width: "100%",
  minHeight: "120px",
  borderRadius: "18px",
  border: "1px solid rgba(129, 140, 248, 0.2)",
  padding: "14px 16px",
  font: "inherit",
  color: "var(--text)",
  background: "rgba(8, 10, 26, 0.4)",
  resize: "vertical",
} satisfies CSSProperties;

const helperStyle = {
  margin: 0,
  color: "var(--text-muted)",
  lineHeight: 1.6,
} satisfies CSSProperties;

const metaTextStyle = {
  color: "var(--text-muted)",
  lineHeight: 1.6,
} satisfies CSSProperties;

const emptyStateStyle = {
  margin: 0,
  color: "var(--text-muted)",
  lineHeight: 1.7,
} satisfies CSSProperties;

const referencePreviewStyle = {
  margin: 0,
} satisfies CSSProperties;

const referencePreviewImageStyle = {
  width: "100%",
  maxWidth: "420px",
  height: "220px",
  objectFit: "cover",
  borderRadius: "18px",
  border: "1px solid rgba(129, 140, 248, 0.16)",
} satisfies CSSProperties;

const assetGridStyle = {
  display: "grid",
  gap: "16px",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
} satisfies CSSProperties;

const assetCardStyle = {
  display: "grid",
  gap: "12px",
  padding: "16px",
  borderRadius: "20px",
  border: "1px solid rgba(129, 140, 248, 0.16)",
  background: "rgba(8, 10, 26, 0.26)",
} satisfies CSSProperties;

const assetImageStyle = {
  width: "100%",
  height: "180px",
  objectFit: "cover",
  borderRadius: "16px",
  border: "1px solid rgba(129, 140, 248, 0.16)",
} satisfies CSSProperties;

const assetPlaceholderStyle = {
  width: "100%",
  height: "180px",
  display: "grid",
  placeItems: "center",
  borderRadius: "16px",
  border: "1px dashed rgba(129, 140, 248, 0.26)",
  color: "var(--text-muted)",
  background: "rgba(15, 23, 42, 0.52)",
} satisfies CSSProperties;

const assetCopyStyle = {
  display: "grid",
  gap: "6px",
} satisfies CSSProperties;

const assetTitleStyle = {
  fontSize: "1rem",
  lineHeight: 1.5,
  wordBreak: "break-word",
} satisfies CSSProperties;

const assetMetaStyle = {
  color: "var(--text-muted)",
  lineHeight: 1.6,
  wordBreak: "break-word",
} satisfies CSSProperties;
