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
  originalName: string | null;
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
  binding: {
    imageReferenceAssetIds: string[];
  };
  defaultReferenceAssets: ImageAssetSummary[];
  referenceAssets: ImageAssetSummary[];
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

const EMPTY_ASSETS: ImageAssetSummary[] = [];

const copy = {
  workflowTitle: "项目制作流程",
  stageTitle: "图片",
  stageDescription:
    "从项目资产中心带入默认参考图，或者临时改选本次输入。未选择任何参考图时，仍然可以直接发起文生图。",
  projectLabel: "当前项目",
  backToProject: "返回项目制作台",
  activeStage: "当前阶段",
  noIdea: "项目还没有补充创意说明，先确认分镜方向，再继续生成关键画面。",
  scriptStage: "脚本",
  storyboardStage: "分镜",
  imagesStage: "图片",
  videosStage: "视频",
  stageActive: "进行中",
  stageWaiting: "待开始",
  stageNext: "下一步",
  defaultBindingHeading: "当前默认参考图",
  defaultBindingDescription:
    "进入图片页时会自动带出项目级默认参考图。你可以临时改选本次输入，也可以把新的组合设为默认输入。",
  defaultBindingEmpty: "当前未设置默认参考图",
  openAssetCenter: "前往资产中心设置",
  inputHeading: "本次生成输入",
  inputDescription:
    "可从项目内已存在的图片资产中多选本次输入；未选择参考图时，会直接走文生图。",
  referenceHeading: "候选参考图",
  referenceEmpty: "当前项目还没有可用图片，请先在资产中心上传图片或完成上游流程。",
  selectedCountPrefix: "已选择参考图：",
  temporaryOverride: "仅本次使用",
  defaultBindingBadge: "当前默认输入",
  textOnlyBadge: "纯文本生成",
  promoteDefault: "设为默认输入",
  promoteSuccess: "已更新图片默认参考图。",
  promoteFailed: "更新图片默认参考图失败",
  promptLabel: "图片提示词",
  promptPlaceholder: "描述你想生成的画面、风格和主体动作……",
  promptHelperPrefix: "当前上传上限：",
  generateImage: "生成图片",
  resultsHeading: "图片结果",
  resultsDescription: "生成完成的图片会保留在当前项目中，便于继续进入视频流程。",
  noResults: "当前项目还没有生成图片。",
  previewUnavailable: "暂无预览",
  loadingProject: "加载项目中…",
  loadWorkspaceFailed: "加载图片工作区失败",
  fetchTaskFailed: "获取图片任务状态失败",
  refreshFailedPrefix: "图片已生成，但刷新结果失败：",
  generating: "正在生成图片…",
  refreshing: "正在刷新结果…",
  queued: "图片任务已加入队列。",
  generated: "图片已生成。",
  failed: "图片生成失败",
  missingProjectId: "缺少项目 ID",
  enterPrompt: "请先输入图片提示词。",
  enqueueFailed: "图片任务提交失败",
  taskPrefix: "任务：",
  scriptDetail: "脚本确认后继续细化画面提示。",
  storyboardDetail: "分镜输出后可继续生成关键画面。",
  imagesDetail: "当前页面负责管理文生图和图生图结果。",
  videosDetail: "挑选满意的图片后继续进入视频阶段。",
  enterScript: "前往脚本",
  enterStoryboard: "前往分镜",
  enterImages: "继续图片",
  enterVideos: "前往视频",
} as const;

function areAssetIdListsEqual(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function formatAssetMeta(asset: ImageAssetSummary) {
  return `${asset.mimeType} · ${Math.max(1, Math.round(asset.sizeBytes / 1024))} KB`;
}

function mergeSelectedReferenceIds(
  workspace: ImagesWorkspaceResponse,
  currentSelection: string[],
) {
  const validAssetIds = new Set(workspace.referenceAssets.map((asset) => asset.id));
  const preservedSelection = currentSelection.filter((assetId) => validAssetIds.has(assetId));

  if (preservedSelection.length > 0) {
    return preservedSelection;
  }

  return workspace.binding.imageReferenceAssetIds.filter((assetId) => validAssetIds.has(assetId));
}

export default function ProjectImagesPage() {
  const params = useParams<{ projectId: string }>();
  const routeProjectId = params.projectId ?? "";
  const latestRouteProjectIdRef = useRef(routeProjectId);
  latestRouteProjectIdRef.current = routeProjectId;
  const workspaceRequestSeq = useRef(0);
  const submitRequestSeq = useRef(0);
  const [projectId, setProjectId] = useState("");
  const [workspace, setWorkspace] = useState<ImagesWorkspaceResponse | null>(null);
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPromotingDefault, setIsPromotingDefault] = useState(false);
  const { task, error: pollingError } = useTaskPolling(activeTaskId);

  useEffect(() => {
    setProjectId(params.projectId ?? "");
  }, [params]);

  async function reloadWorkspace(nextProjectId: string) {
    const requestId = (workspaceRequestSeq.current += 1);
    const response = await fetch(`/api/images?projectId=${encodeURIComponent(nextProjectId)}`, {
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as
      | ImagesWorkspaceResponse
      | { error?: string }
      | null;

    if (!response.ok || !payload || !("project" in payload)) {
      if (requestId !== workspaceRequestSeq.current) {
        return null;
      }

      throw new Error(
        payload && "error" in payload
          ? payload.error ?? copy.loadWorkspaceFailed
          : copy.loadWorkspaceFailed,
      );
    }

    if (requestId !== workspaceRequestSeq.current) {
      return null;
    }

    return payload;
  }

  useEffect(() => {
    if (!projectId) {
      return;
    }

    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setWorkspace(null);
      setSelectedReferenceIds([]);
      setActiveTaskId(null);
      setStatusMessage(null);
      setError(null);
      setIsSubmitting(false);
      setIsPromotingDefault(false);

      try {
        const payload = await reloadWorkspace(projectId);

        if (!cancelled && payload) {
          setWorkspace(payload);
          setSelectedReferenceIds(mergeSelectedReferenceIds(payload, []));
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : copy.loadWorkspaceFailed,
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
    setError(pollingError instanceof Error ? pollingError.message : copy.fetchTaskFailed);
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

      setStatusMessage(copy.refreshing);

      void (async () => {
        try {
          const payload = await reloadWorkspace(projectId);
          if (!payload) {
            return;
          }

          setWorkspace(payload);
          setSelectedReferenceIds((current) => mergeSelectedReferenceIds(payload, current));
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
  const resultAssets = workspace?.assets ?? EMPTY_ASSETS;
  const defaultReferenceIds = workspace?.binding.imageReferenceAssetIds ?? [];
  const isUsingTemporarySelection = !areAssetIdListsEqual(selectedReferenceIds, defaultReferenceIds);
  const isBusy = isLoading || isSubmitting || isPromotingDefault || Boolean(activeTaskId);
  const canSubmit = Boolean(projectId && prompt.trim() && !isBusy);
  const canPromoteDefault = Boolean(
    selectedReferenceIds.length > 0 && isUsingTemporarySelection && !isBusy,
  );

  const activeSelectionBadge =
    selectedReferenceIds.length === 0
      ? copy.textOnlyBadge
      : isUsingTemporarySelection
        ? copy.temporaryOverride
        : copy.defaultBindingBadge;

  const selectedReferenceAssets = useMemo(
    () => referenceAssets.filter((asset) => selectedReferenceIds.includes(asset.id)),
    [referenceAssets, selectedReferenceIds],
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

    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setError(copy.enterPrompt);
      return;
    }

    const submitRouteProjectId = latestRouteProjectIdRef.current;
    const submitRequestId = (submitRequestSeq.current += 1);
    setIsSubmitting(true);
    setError(null);
    setStatusMessage(null);

    try {
      const form = new FormData();
      form.set("projectId", projectId);
      form.set("prompt", trimmedPrompt);
      for (const assetId of selectedReferenceIds) {
        form.append("referenceAssetIds", assetId);
      }

      const response = await fetch("/api/images", {
        method: "POST",
        body: form,
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

  async function promoteDefault() {
    if (!projectId || selectedReferenceIds.length === 0) {
      return;
    }

    setIsPromotingDefault(true);
    setError(null);
    setStatusMessage(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/workflow-binding`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          imageReferenceAssetIds: selectedReferenceIds,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { imageReferenceAssetIds?: string[]; error?: string }
        | null;

      if (!response.ok || !payload?.imageReferenceAssetIds) {
        throw new Error(payload?.error ?? copy.promoteFailed);
      }

      setWorkspace((current) => {
        if (!current) {
          return current;
        }

        const assetsById = new Map(current.referenceAssets.map((asset) => [asset.id, asset]));
        return {
          ...current,
          binding: {
            imageReferenceAssetIds: payload.imageReferenceAssetIds ?? [],
          },
          defaultReferenceAssets: (payload.imageReferenceAssetIds ?? [])
            .map((assetId) => assetsById.get(assetId))
            .filter((asset): asset is ImageAssetSummary => Boolean(asset)),
        };
      });
      setStatusMessage(copy.promoteSuccess);
    } catch (promoteError) {
      setError(promoteError instanceof Error ? promoteError.message : copy.promoteFailed);
    } finally {
      setIsPromotingDefault(false);
    }
  }

  const projectSummary = workspace?.project.idea?.trim() || copy.noIdea;
  const heroProjectTitle = isLoading
    ? copy.loadingProject
    : workspace?.project.title ?? copy.stageTitle;

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
            <h2 style={heroSupportTitleStyle}>{heroProjectTitle}</h2>
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
            summary: "脚本确认后继续细化画面提示。",
            badgeLabel: copy.stageWaiting,
            tone: "neutral",
            href: `/projects/${projectId}/script`,
            ctaLabel: copy.enterScript,
          },
          {
            label: copy.storyboardStage,
            detail: copy.storyboardDetail,
            summary: "分镜输出完成后可继续生成关键画面。",
            badgeLabel: copy.stageWaiting,
            tone: "neutral",
            href: `/projects/${projectId}/storyboard`,
            ctaLabel: copy.enterStoryboard,
          },
          {
            label: copy.imagesStage,
            detail: copy.imagesDetail,
            summary:
              selectedReferenceAssets.length > 0
                ? `当前已选 ${selectedReferenceAssets.length} 张参考图。`
                : "当前未选择参考图，将直接发起文生图。",
            badgeLabel: copy.stageActive,
            tone: "active",
            href: `/projects/${projectId}/images`,
            ctaLabel: copy.enterImages,
          },
          {
            label: copy.videosStage,
            detail: copy.videosDetail,
            summary:
              resultAssets.length > 0
                ? "已有图片结果，可继续进入视频阶段。"
                : "等待先生成图片结果。",
            badgeLabel: resultAssets.length > 0 ? copy.stageNext : copy.stageWaiting,
            tone: resultAssets.length > 0 ? "warning" : "neutral",
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

      <div style={twoColumnGridStyle}>
        <section style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <h2 style={sectionTitleStyle}>{copy.defaultBindingHeading}</h2>
            <p style={sectionDescriptionStyle}>{copy.defaultBindingDescription}</p>
          </div>

          {workspace?.defaultReferenceAssets.length ? (
            <div style={referenceGridStyle}>
              {workspace.defaultReferenceAssets.map((asset) => (
                <article key={asset.id} style={referenceCardStyle}>
                  {asset.previewDataUrl ? (
                    <Image
                      src={asset.previewDataUrl}
                      alt={asset.originalName ?? asset.id}
                      width={260}
                      height={160}
                      unoptimized
                      style={referenceImageStyle}
                    />
                  ) : (
                    <div style={referencePlaceholderStyle}>{copy.previewUnavailable}</div>
                  )}
                  <div style={cardHeaderStyle}>
                    <div style={cardHeaderCopyStyle}>
                      <strong style={assetTitleStyle}>{asset.originalName ?? asset.id}</strong>
                      <span style={assetMetaStyle}>{formatAssetMeta(asset)}</span>
                    </div>
                    <StatusBadge label={copy.defaultBindingBadge} tone="active" />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div style={emptyStateStackStyle}>
              <p style={emptyStateStyle}>{copy.defaultBindingEmpty}</p>
              <Link href={`/projects/${projectId}/assets`} style={secondaryActionStyle}>
                {copy.openAssetCenter}
              </Link>
            </div>
          )}
        </section>

        <section style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <h2 style={sectionTitleStyle}>{copy.inputHeading}</h2>
            <p style={sectionDescriptionStyle}>{copy.inputDescription}</p>
          </div>

          <div style={cardHeaderStyle}>
            <div style={cardHeaderCopyStyle}>
              <strong style={sectionTitleStyle}>{copy.referenceHeading}</strong>
              <span style={sectionDescriptionStyle}>
                {selectedReferenceIds.length > 0
                  ? `${copy.selectedCountPrefix}${selectedReferenceIds.length}`
                  : "不选参考图时会走文生图。"}
              </span>
            </div>
            <StatusBadge
              label={activeSelectionBadge}
              tone={
                selectedReferenceIds.length === 0
                  ? "neutral"
                  : isUsingTemporarySelection
                    ? "warning"
                    : "active"
              }
            />
          </div>

          {referenceAssets.length === 0 ? (
            <p style={emptyStateStyle}>{copy.referenceEmpty}</p>
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
                        alt={asset.originalName ?? asset.id}
                        width={260}
                        height={160}
                        unoptimized
                        style={referenceImageStyle}
                      />
                    ) : (
                      <div style={referencePlaceholderStyle}>{copy.previewUnavailable}</div>
                    )}
                    <div style={cardHeaderCopyStyle}>
                      <strong style={assetTitleStyle}>{asset.originalName ?? asset.id}</strong>
                      <span style={assetMetaStyle}>{formatAssetMeta(asset)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <label style={fieldStyle} htmlFor="imagePromptInput">
            <span style={fieldLabelStyle}>{copy.promptLabel}</span>
            <textarea
              id="imagePromptInput"
              aria-label="图片提示词输入框"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              disabled={isBusy}
              placeholder={copy.promptPlaceholder}
              style={textareaStyle}
              rows={4}
            />
          </label>
          <p style={helperStyle}>
            {copy.promptHelperPrefix}
            {workspace?.maxUploadMb ?? 25} MB
          </p>

          <div style={buttonRowStyle}>
            {canPromoteDefault ? (
              <button
                type="button"
                onClick={() => void promoteDefault()}
                disabled={!canPromoteDefault}
                style={secondaryButtonStyle}
              >
                {copy.promoteDefault}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit}
              style={primaryButtonStyle}
            >
              {copy.generateImage}
            </button>
            {activeTaskId ? (
              <span style={metaTextStyle}>
                {copy.taskPrefix}
                {activeTaskId}
              </span>
            ) : null}
          </div>
        </section>
      </div>

      <section style={panelStyle}>
        <div style={sectionHeaderStyle}>
          <h2 style={sectionTitleStyle}>{copy.resultsHeading}</h2>
          <p style={sectionDescriptionStyle}>{copy.resultsDescription}</p>
        </div>

        {resultAssets.length === 0 ? (
          <p style={emptyStateStyle}>{copy.noResults}</p>
        ) : (
          <div style={assetGridStyle}>
            {resultAssets.map((asset) => (
              <article key={asset.id} style={assetCardStyle}>
                {asset.previewDataUrl ? (
                  <Image
                    src={asset.previewDataUrl}
                    alt={asset.originalName ?? asset.id}
                    width={320}
                    height={180}
                    unoptimized
                    style={assetImageStyle}
                  />
                ) : (
                  <div style={assetPlaceholderStyle}>{copy.previewUnavailable}</div>
                )}
                <div style={cardHeaderCopyStyle}>
                  <strong style={assetTitleStyle}>{asset.originalName ?? asset.id}</strong>
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

const twoColumnGridStyle = {
  display: "grid",
  gap: "20px",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
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

const emptyStateStackStyle = {
  display: "grid",
  gap: "12px",
  justifyItems: "start",
} satisfies CSSProperties;

const cardHeaderStyle = {
  display: "flex",
  alignItems: "start",
  justifyContent: "space-between",
  gap: "12px",
  flexWrap: "wrap",
} satisfies CSSProperties;

const cardHeaderCopyStyle = {
  display: "grid",
  gap: "6px",
} satisfies CSSProperties;

const referenceGridStyle = {
  display: "grid",
  gap: "12px",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
} satisfies CSSProperties;

const referenceCardStyle = {
  display: "grid",
  gap: "10px",
  padding: "12px",
  borderRadius: "18px",
  border: "1px solid rgba(129, 140, 248, 0.16)",
  background: "rgba(8, 10, 26, 0.26)",
  color: "var(--text)",
  textAlign: "left",
} satisfies CSSProperties;

const selectedReferenceCardStyle = {
  ...referenceCardStyle,
  border: "1px solid rgba(202, 138, 4, 0.55)",
  boxShadow: "0 0 0 2px rgba(202, 138, 4, 0.12)",
} satisfies CSSProperties;

const referenceImageStyle = {
  width: "100%",
  height: "160px",
  objectFit: "cover",
  borderRadius: "14px",
  border: "1px solid rgba(129, 140, 248, 0.16)",
} satisfies CSSProperties;

const referencePlaceholderStyle = {
  width: "100%",
  height: "160px",
  display: "grid",
  placeItems: "center",
  borderRadius: "14px",
  border: "1px dashed rgba(129, 140, 248, 0.26)",
  background: "rgba(15, 23, 42, 0.52)",
  color: "var(--text-muted)",
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
