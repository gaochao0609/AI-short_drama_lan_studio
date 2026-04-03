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

type AssetSummary = {
  id: string;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  taskId?: string | null;
  createdAt: string;
  previewDataUrl?: string | null;
  previewUrl?: string | null;
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

const copy = {
  workflowTitle: "项目制作流程",
  stageTitle: "视频",
  stageDescription:
    "从项目内已有关键画面中选择参考图，补充运动、镜头和节奏描述，生成最终视频镜头。",
  projectLabel: "当前项目",
  backToProject: "返回项目制作台",
  activeStage: "当前阶段",
  noIdea: "项目还没有补充创意说明，先确认图片方向后再进入视频阶段。",
  scriptStage: "脚本",
  storyboardStage: "分镜",
  imagesStage: "图片",
  videosStage: "视频",
  stageDone: "已完成",
  stageActive: "进行中",
  stageWaiting: "待开始",
  generateHeading: "生成设置",
  generateDescription:
    "视频任务只接受项目内已有图片 ID，不会在这里重复上传素材。",
  promptLabel: "视频提示词",
  promptPlaceholder: "描述镜头运动、主体动作和节奏...",
  referencesLabel: "参考图片",
  referencesDescription:
    "至少选择一张项目内图片作为参考素材，再发起视频任务。",
  selectedReferencesPrefix: "已选参考图：",
  taskProgressHeading: "任务状态",
  taskProgressDescription:
    "任务提交后会在这里显示当前轮询状态和近期任务历史。",
  videosHeading: "视频结果",
  videosDescription:
    "生成完成的视频会保留在项目结果区，方便继续回看和筛选。",
  noReferenceAssets: "当前项目还没有可用图片，请先完成图片阶段。",
  noRunningTask: "当前没有正在运行的视频任务。",
  noVideos: "当前项目还没有生成视频。",
  previewUnavailable: "暂无预览",
  loadingProject: "加载项目中...",
  loadWorkspaceFailed: "加载视频工作区失败",
  fetchTaskFailed: "获取任务状态失败",
  refreshing: "正在刷新结果...",
  generating: "正在生成视频...",
  generated: "视频已生成。",
  queued: "视频任务已加入队列。",
  failed: "视频生成失败",
  refreshFailedPrefix: "视频已生成，但刷新结果失败：",
  missingProjectId: "缺少项目 ID",
  enterPrompt: "请先输入提示词，再生成视频。",
  selectReference: "请至少选择一张参考图片。",
  enqueueFailed: "视频任务提交失败",
  scriptDetail: "脚本定稿后保留故事结构和对白。",
  storyboardDetail: "分镜确认镜头段落和视频提示词。",
  imagesDetail: "从关键画面中筛选可进入视频阶段的参考图。",
  videosDetail: "当前页负责管理视频任务和输出结果。",
  enterScript: "前往脚本",
  enterStoryboard: "前往分镜",
  enterImages: "前往图片",
  enterVideos: "继续视频",
  taskPrefix: "任务：",
  statusPrefix: "状态：",
} as const;

function formatAssetMeta(asset: AssetSummary) {
  return `${asset.mimeType} · ${Math.round(asset.sizeBytes / 1024)} KB`;
}

function formatAssetKind(kind: string) {
  switch (kind) {
    case "image_generated":
      return "生成图片";
    case "image_reference":
      return "参考图片";
    case "video_generated":
      return "生成视频";
    default:
      return kind;
  }
}

function formatTaskStatus(status?: string) {
  switch (status) {
    case "QUEUED":
      return "排队中";
    case "RUNNING":
      return "进行中";
    case "SUCCEEDED":
      return "已完成";
    case "FAILED":
      return "失败";
    case "CANCELED":
      return "已取消";
    default:
      return status ?? "未知";
  }
}

export default function ProjectVideosPage() {
  const params = useParams<{ projectId: string }>();
  const routeProjectId = params.projectId ?? "";
  const latestRouteProjectIdRef = useRef(routeProjectId);
  latestRouteProjectIdRef.current = routeProjectId;
  const workspaceRequestSeq = useRef(0);
  const submitRequestSeq = useRef(0);
  const [projectId, setProjectId] = useState("");
  const [workspace, setWorkspace] = useState<VideosWorkspaceResponse | null>(
    null,
  );
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
      const response = await fetch(
        `/api/videos?projectId=${encodeURIComponent(nextProjectId)}`,
        {
          cache: "no-store",
        },
      );
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
            ? payload.error ?? copy.loadWorkspaceFailed
            : copy.loadWorkspaceFailed,
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
          setError(
            loadError instanceof Error
              ? loadError.message
              : copy.loadWorkspaceFailed,
          );
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
    setError(
      pollingError instanceof Error ? pollingError.message : copy.fetchTaskFailed,
    );
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
      setStatusMessage(copy.refreshing);

      if (!projectId) {
        setStatusMessage(copy.generated);
        return;
      }

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
              : copy.loadWorkspaceFailed;
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

    if (selectedReferenceIds.length === 0) {
      setError(copy.selectReference);
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
        throw new Error(payload?.error ?? copy.enqueueFailed);
      }

      if (latestRouteProjectIdRef.current !== submitRouteProjectId) {
        return;
      }

      setActiveTaskId(payload.taskId);
      setStatusMessage(copy.queued);
    } catch (submitError) {
      if (latestRouteProjectIdRef.current !== submitRouteProjectId) {
        return;
      }

      setStatusMessage(null);
      setError(
        submitError instanceof Error ? submitError.message : copy.enqueueFailed,
      );
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
              {isLoading
                ? copy.loadingProject
                : workspace?.project.title ?? copy.loadingProject}
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
            summary: "保留完整脚本结构，作为后续所有素材的创作基础。",
            badgeLabel: copy.stageDone,
            tone: "active",
            href: `/projects/${projectId}/script`,
            ctaLabel: copy.enterScript,
          },
          {
            label: copy.storyboardStage,
            detail: copy.storyboardDetail,
            summary: "分镜确定镜头节奏和视频提示词。",
            badgeLabel: copy.stageDone,
            tone: "active",
            href: `/projects/${projectId}/storyboard`,
            ctaLabel: copy.enterStoryboard,
          },
          {
            label: copy.imagesStage,
            detail: referenceAssets.length
              ? `当前可选 ${referenceAssets.length} 张图片作为参考。`
              : copy.imagesDetail,
            summary: "从项目内图片中挑选要进入视频阶段的关键画面。",
            badgeLabel: referenceAssets.length ? copy.stageDone : copy.stageWaiting,
            tone: referenceAssets.length ? "active" : "neutral",
            href: `/projects/${projectId}/images`,
            ctaLabel: copy.enterImages,
          },
          {
            label: copy.videosStage,
            detail: videoAssets.length
              ? `当前已归档 ${videoAssets.length} 条视频结果。`
              : copy.videosDetail,
            summary:
              selectedReferenceIds.length > 0
                ? "参考图已选中，可直接发起视频任务。"
                : "先选中一张或多张参考图。",
            badgeLabel: copy.stageActive,
            tone: "active",
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

        <div style={fieldGridStyle}>
          <label style={fieldStyle} htmlFor="videoPromptInput">
            <span style={fieldLabelStyle}>{copy.promptLabel}</span>
            <textarea
              id="videoPromptInput"
              aria-label="Video prompt input"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              disabled={isBusy}
              placeholder={copy.promptPlaceholder}
              style={textareaStyle}
              rows={5}
            />
          </label>
        </div>

        <div style={fieldGridStyle}>
          <div style={sectionHeaderStyle}>
            <h3 style={subsectionTitleStyle}>{copy.referencesLabel}</h3>
            <p style={sectionDescriptionStyle}>{copy.referencesDescription}</p>
          </div>

          {referenceAssets.length === 0 ? (
            <p style={emptyStateStyle}>{copy.noReferenceAssets}</p>
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
                    style={selected ? selectedReferenceCardStyle : referenceCardStyle}
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
                      <div style={referencePlaceholderStyle}>{copy.previewUnavailable}</div>
                    )}
                    <span style={referenceMetaStyle}>
                      {asset.id}
                      <br />
                      {formatAssetKind(asset.kind)} ·{" "}
                      {Math.round(asset.sizeBytes / 1024)} KB
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {selectedReferences.length > 0 ? (
          <p style={helperTextStyle}>
            {copy.selectedReferencesPrefix}
            {selectedReferences.length}
          </p>
        ) : null}

        <div style={buttonRowStyle}>
          <button
            type="button"
            aria-label="Generate video"
            onClick={() => void submit()}
            disabled={!canSubmit}
            style={primaryButtonStyle}
          >
            生成视频
          </button>
          {activeTaskId ? (
            <span style={metaTextStyle}>
              {copy.taskPrefix}
              {activeTaskId}
            </span>
          ) : null}
        </div>
      </section>

      <div style={twoColumnGridStyle}>
        <section style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <h2 style={sectionTitleStyle}>{copy.taskProgressHeading}</h2>
            <p style={sectionDescriptionStyle}>{copy.taskProgressDescription}</p>
          </div>
          {activeTaskId ? (
            <article style={resultCardStyle}>
              <strong style={resultTitleStyle}>{activeTaskId}</strong>
              <span style={resultMetaTextStyle}>
                {copy.statusPrefix}
                {formatTaskStatus(task?.status ?? "QUEUED")}
              </span>
            </article>
          ) : (
            <p style={emptyStateStyle}>{copy.noRunningTask}</p>
          )}

          {recentTasks.length > 0 ? (
            <div style={taskListStyle}>
              {recentTasks.map((taskItem) => (
                <article key={taskItem.id} style={resultCardStyle}>
                  <strong style={resultTitleStyle}>{taskItem.id}</strong>
                  <span style={resultMetaTextStyle}>
                    {formatTaskStatus(taskItem.status)} ·{" "}
                    {new Date(taskItem.createdAt).toLocaleString("zh-CN")}
                  </span>
                  {taskItem.errorText ? (
                    <span style={taskErrorStyle}>{taskItem.errorText}</span>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
        </section>

        <section style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <h2 style={sectionTitleStyle}>{copy.videosHeading}</h2>
            <p style={sectionDescriptionStyle}>{copy.videosDescription}</p>
          </div>
          {videoAssets.length === 0 ? (
            <p style={emptyStateStyle}>{copy.noVideos}</p>
          ) : (
            <div style={videoGridStyle}>
              {videoAssets.map((asset) => (
                <article key={asset.id} style={videoCardStyle}>
                  {asset.previewUrl || asset.previewDataUrl ? (
                    <video
                      controls
                      preload="metadata"
                      style={videoPreviewStyle}
                      src={asset.previewUrl ?? asset.previewDataUrl ?? undefined}
                    />
                  ) : (
                    <div style={videoPlaceholderStyle}>{copy.previewUnavailable}</div>
                  )}
                  <div style={videoCopyStyle}>
                    <strong style={videoTitleStyle}>{asset.id}</strong>
                    <span style={videoMetaStyle}>{formatAssetMeta(asset)}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
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

const subsectionTitleStyle = {
  margin: 0,
  fontSize: "1rem",
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
  border: "1px solid rgba(129, 140, 248, 0.16)",
  background: "rgba(8, 10, 26, 0.26)",
  color: "var(--text)",
  cursor: "pointer",
  textAlign: "left",
} satisfies CSSProperties;

const selectedReferenceCardStyle = {
  ...referenceCardStyle,
  border: "1px solid rgba(202, 138, 4, 0.55)",
  boxShadow: "0 0 0 2px rgba(202, 138, 4, 0.12)",
} satisfies CSSProperties;

const referenceImageStyle = {
  width: "100%",
  height: "150px",
  objectFit: "cover",
  borderRadius: "14px",
  border: "1px solid rgba(129, 140, 248, 0.16)",
} satisfies CSSProperties;

const referencePlaceholderStyle = {
  width: "100%",
  height: "150px",
  display: "grid",
  placeItems: "center",
  borderRadius: "14px",
  border: "1px dashed rgba(129, 140, 248, 0.26)",
  background: "rgba(15, 23, 42, 0.52)",
  color: "var(--text-muted)",
} satisfies CSSProperties;

const referenceMetaStyle = {
  lineHeight: 1.6,
  wordBreak: "break-word",
} satisfies CSSProperties;

const helperTextStyle = {
  margin: 0,
  color: "var(--text-muted)",
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

const metaTextStyle = {
  color: "var(--text-muted)",
  lineHeight: 1.6,
} satisfies CSSProperties;

const emptyStateStyle = {
  margin: 0,
  color: "var(--text-muted)",
  lineHeight: 1.7,
} satisfies CSSProperties;

const twoColumnGridStyle = {
  display: "grid",
  gap: "20px",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
} satisfies CSSProperties;

const resultCardStyle = {
  display: "grid",
  gap: "6px",
  padding: "16px",
  borderRadius: "18px",
  border: "1px solid rgba(129, 140, 248, 0.16)",
  background: "rgba(8, 10, 26, 0.26)",
} satisfies CSSProperties;

const resultTitleStyle = {
  fontSize: "1rem",
  lineHeight: 1.6,
  wordBreak: "break-word",
} satisfies CSSProperties;

const resultMetaTextStyle = {
  color: "var(--text-muted)",
  lineHeight: 1.6,
  wordBreak: "break-word",
} satisfies CSSProperties;

const taskListStyle = {
  display: "grid",
  gap: "10px",
} satisfies CSSProperties;

const taskErrorStyle = {
  color: "#fecaca",
  lineHeight: 1.6,
} satisfies CSSProperties;

const videoGridStyle = {
  display: "grid",
  gap: "16px",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
} satisfies CSSProperties;

const videoCardStyle = {
  display: "grid",
  gap: "12px",
  padding: "16px",
  borderRadius: "20px",
  border: "1px solid rgba(129, 140, 248, 0.16)",
  background: "rgba(8, 10, 26, 0.26)",
} satisfies CSSProperties;

const videoPreviewStyle = {
  width: "100%",
  height: "220px",
  borderRadius: "16px",
  border: "1px solid rgba(129, 140, 248, 0.16)",
  background: "#000",
  objectFit: "cover",
} satisfies CSSProperties;

const videoPlaceholderStyle = {
  width: "100%",
  height: "220px",
  display: "grid",
  placeItems: "center",
  borderRadius: "16px",
  border: "1px dashed rgba(129, 140, 248, 0.26)",
  background: "rgba(15, 23, 42, 0.52)",
  color: "var(--text-muted)",
} satisfies CSSProperties;

const videoCopyStyle = {
  display: "grid",
  gap: "6px",
} satisfies CSSProperties;

const videoTitleStyle = {
  fontSize: "1rem",
  lineHeight: 1.5,
  wordBreak: "break-word",
} satisfies CSSProperties;

const videoMetaStyle = {
  color: "var(--text-muted)",
  lineHeight: 1.6,
  wordBreak: "break-word",
} satisfies CSSProperties;
