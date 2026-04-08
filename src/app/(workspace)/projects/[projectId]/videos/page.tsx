"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import PageHero from "@/components/studio/page-hero";
import StatusBadge from "@/components/studio/status-badge";
import WorkflowRail from "@/components/studio/workflow-rail";
import useTaskPolling from "@/hooks/useTaskPolling";

type AssetSummary = {
  id: string;
  originalName: string | null;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  previewDataUrl?: string | null;
  previewUrl?: string | null;
};

type VideoTaskSummary = {
  id: string;
  status: string;
  createdAt: string;
  errorText?: string | null;
};

type VideosWorkspaceResponse = {
  project: {
    id: string;
    title: string;
    idea?: string | null;
  };
  binding: {
    videoReferenceAssetIds: string[];
  };
  defaultReferenceAssets: AssetSummary[];
  referenceAssets: AssetSummary[];
  videoAssets: AssetSummary[];
  tasks: VideoTaskSummary[];
};

type TaskPollResponse = {
  id: string;
  status: string;
  errorText?: string | null;
};

const EMPTY_ASSETS: AssetSummary[] = [];
const EMPTY_TASKS: VideoTaskSummary[] = [];
const MAX_REFERENCE_ASSETS = 8;

const copy = {
  workflowTitle: "项目制作流程",
  title: "视频",
  description: "从项目资产中心带入默认参考图，补充运动和镜头描述，继续生成最终视频镜头。",
  projectLabel: "当前项目",
  backToProject: "返回项目制作台",
  activeStage: "当前阶段",
  noIdea: "项目还没有补充创意说明，建议先确认图片方向，再继续进入视频阶段。",
  scriptStage: "脚本",
  storyboardStage: "分镜",
  imagesStage: "图片",
  videosStage: "视频",
  stageActive: "进行中",
  stageWaiting: "待开始",
  defaultHeading: "当前默认参考图",
  defaultBindingDescription:
    "视频页会自动带出项目级默认参考图。你可以临时改选本次输入，也可以把新的组合设为默认输入。",
  defaultEmpty: "当前未设置默认参考图",
  openAssets: "前往资产中心设置",
  inputHeading: "本次生成输入",
  referenceHeading: "候选参考图",
  promptLabel: "视频提示词",
  promptPlaceholder: "描述镜头运动、主体动作和节奏变化……",
  selectedCountPrefix: "已选择参考图：",
  temporaryOverride: "仅本次使用",
  defaultBadge: "当前默认输入",
  promoteDefault: "设为默认输入",
  promoteSuccess: "已更新视频默认参考图。",
  promoteFailed: "更新视频默认参考图失败",
  generate: "生成视频",
  resultsHeading: "视频结果",
  noResults: "当前项目还没有生成视频。",
  noReferences: "当前项目还没有可用图片，请先完成图片阶段或在资产中心上传图片。",
  previewUnavailable: "暂无预览",
  loading: "加载项目中…",
  loadFailed: "加载视频工作区失败",
  fetchTaskFailed: "获取视频任务状态失败",
  refreshFailedPrefix: "视频已生成，但刷新结果失败：",
  generating: "正在生成视频…",
  refreshing: "正在刷新结果…",
  queued: "视频任务已加入队列。",
  generated: "视频已生成。",
  failed: "视频生成失败",
  missingProjectId: "缺少项目 ID",
  enterPrompt: "请先输入视频提示词。",
  selectReference: "请至少选择一张参考图。",
  enqueueFailed: "视频任务提交失败",
  referenceLimit: `单次最多选择 ${MAX_REFERENCE_ASSETS} 张参考图。`,
  taskPrefix: "任务：",
  statusPrefix: "状态：",
  scriptDetail: "脚本确认后保留叙事结构和对白。",
  storyboardDetail: "分镜输出后可继续串联镜头节奏。",
  imagesDetail: "从图片结果中筛选进入视频阶段的参考图。",
  videosDetail: "当前页面负责管理视频任务和输出结果。",
  enterScript: "前往脚本",
  enterStoryboard: "前往分镜",
  enterImages: "前往图片",
  enterVideos: "继续视频",
} as const;

function areListsEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function formatAssetMeta(asset: AssetSummary) {
  return `${asset.mimeType} · ${Math.max(1, Math.round(asset.sizeBytes / 1024))} KB`;
}

function normalizeReferenceSelection(assetIds: string[], validAssetIds: Set<string>) {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const assetId of assetIds) {
    if (!validAssetIds.has(assetId) || seen.has(assetId)) {
      continue;
    }

    seen.add(assetId);
    normalized.push(assetId);

    if (normalized.length >= MAX_REFERENCE_ASSETS) {
      break;
    }
  }

  return normalized;
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
  const [workspace, setWorkspace] = useState<VideosWorkspaceResponse | null>(null);
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
    const response = await fetch(`/api/videos?projectId=${encodeURIComponent(nextProjectId)}`, {
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as
      | VideosWorkspaceResponse
      | { error?: string }
      | null;

    if (!response.ok || !payload || !("project" in payload)) {
      if (requestId !== workspaceRequestSeq.current) {
        return null;
      }

      throw new Error(payload && "error" in payload ? payload.error ?? copy.loadFailed : copy.loadFailed);
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

      try {
        const payload = await reloadWorkspace(projectId);
        if (!cancelled && payload) {
          const validAssetIds = new Set(payload.referenceAssets.map((asset) => asset.id));
          setWorkspace(payload);
          setSelectedReferenceIds(
            normalizeReferenceSelection(payload.binding.videoReferenceAssetIds, validAssetIds),
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : copy.loadFailed);
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
      setStatusMessage(copy.refreshing);

      void (async () => {
        try {
          const payload = await reloadWorkspace(projectId);
          if (!payload) {
            return;
          }

          setWorkspace(payload);
          setStatusMessage(copy.generated);
        } catch (refreshError) {
          setStatusMessage(null);
          const message = refreshError instanceof Error ? refreshError.message : copy.loadFailed;
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
  const defaultReferenceIds = workspace?.binding.videoReferenceAssetIds ?? [];
  const isUsingTemporarySelection = !areListsEqual(selectedReferenceIds, defaultReferenceIds);
  const isBusy = isLoading || isSubmitting || isPromotingDefault || Boolean(activeTaskId);
  const canSubmit = Boolean(projectId && prompt.trim() && selectedReferenceIds.length > 0 && !isBusy);

  function toggleReferenceAsset(assetId: string) {
    if (selectedReferenceIds.includes(assetId)) {
      setSelectedReferenceIds((current) => current.filter((value) => value !== assetId));
      setError((current) => (current === copy.referenceLimit ? null : current));
      return;
    }

    if (selectedReferenceIds.length >= MAX_REFERENCE_ASSETS) {
      setStatusMessage(null);
      setError(copy.referenceLimit);
      return;
    }

    setSelectedReferenceIds((current) =>
      current.includes(assetId) ? current : [...current, assetId],
    );
    setError((current) => (current === copy.referenceLimit ? null : current));
  }

  async function submit() {
    if (!projectId) {
      setError(copy.missingProjectId);
      return;
    }

    if (!prompt.trim()) {
      setError(copy.enterPrompt);
      return;
    }

    const validAssetIds = new Set(referenceAssets.map((asset) => asset.id));
    const effectiveReferenceIds = normalizeReferenceSelection(selectedReferenceIds, validAssetIds);

    if (effectiveReferenceIds.length === 0) {
      setError(copy.selectReference);
      return;
    }

    const submitRouteProjectId = latestRouteProjectIdRef.current;
    const submitRequestId = (submitRequestSeq.current += 1);
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
          prompt: prompt.trim(),
          referenceAssetIds: effectiveReferenceIds,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { taskId?: string; error?: string } | null;

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
    const validAssetIds = new Set(referenceAssets.map((asset) => asset.id));
    const effectiveReferenceIds = normalizeReferenceSelection(selectedReferenceIds, validAssetIds);

    if (!projectId || effectiveReferenceIds.length === 0) {
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
          videoReferenceAssetIds: effectiveReferenceIds,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { videoReferenceAssetIds?: string[]; error?: string }
        | null;

      if (!response.ok || !payload?.videoReferenceAssetIds) {
        throw new Error(payload?.error ?? copy.promoteFailed);
      }

      setWorkspace((current) =>
        current
          ? {
              ...current,
              binding: {
                videoReferenceAssetIds: normalizeReferenceSelection(
                  payload.videoReferenceAssetIds ?? [],
                  new Set(current.referenceAssets.map((asset) => asset.id)),
                ),
              },
            }
          : current,
      );
      setStatusMessage(copy.promoteSuccess);
    } catch (promoteError) {
      setError(promoteError instanceof Error ? promoteError.message : copy.promoteFailed);
    } finally {
      setIsPromotingDefault(false);
    }
  }

  return (
    <div style={styles.page}>
      <PageHero
        eyebrow={copy.workflowTitle}
        title={copy.title}
        description={copy.description}
        actions={
          <Link href={`/projects/${projectId}`} style={styles.secondaryAction}>
            {copy.backToProject}
          </Link>
        }
        supportingContent={
          <div style={styles.support}>
            <div style={styles.supportHeader}>
              <span style={styles.metaLabel}>{copy.projectLabel}</span>
              <StatusBadge label={copy.activeStage} tone="active" />
            </div>
            <h2 style={styles.supportTitle}>
              {isLoading ? copy.loading : workspace?.project.title ?? copy.title}
            </h2>
            <p style={styles.supportBody}>{workspace?.project.idea?.trim() || copy.noIdea}</p>
          </div>
        }
      />

      <WorkflowRail
        title={copy.workflowTitle}
        layout="cards"
        items={[
          { label: copy.scriptStage, detail: copy.scriptDetail, summary: "脚本确认后继续进入视频规划。", badgeLabel: copy.stageWaiting, tone: "neutral", href: `/projects/${projectId}/script`, ctaLabel: copy.enterScript },
          { label: copy.storyboardStage, detail: copy.storyboardDetail, summary: "分镜确认后再进入视频阶段。", badgeLabel: copy.stageWaiting, tone: "neutral", href: `/projects/${projectId}/storyboard`, ctaLabel: copy.enterStoryboard },
          { label: copy.imagesStage, detail: copy.imagesDetail, summary: referenceAssets.length > 0 ? `当前可选 ${referenceAssets.length} 张参考图。` : "等待图片阶段输出参考图。", badgeLabel: referenceAssets.length > 0 ? copy.stageActive : copy.stageWaiting, tone: referenceAssets.length > 0 ? "active" : "neutral", href: `/projects/${projectId}/images`, ctaLabel: copy.enterImages },
          { label: copy.videosStage, detail: copy.videosDetail, summary: selectedReferenceIds.length > 0 ? `当前已选 ${selectedReferenceIds.length} 张参考图。` : "请至少选择一张参考图后再提交。", badgeLabel: copy.stageActive, tone: "active", href: `/projects/${projectId}/videos`, ctaLabel: copy.enterVideos },
        ]}
      />

      {statusMessage ? <p role="status" style={styles.notice}>{statusMessage}</p> : null}
      {error ? <p role="alert" style={styles.error}>{error}</p> : null}

      <section style={styles.panel}>
        <div style={styles.header}>
          <h2 style={styles.heading}>{copy.defaultHeading}</h2>
          <p style={styles.description}>{copy.defaultBindingDescription}</p>
        </div>
        {workspace?.defaultReferenceAssets.length ? (
          <div style={styles.grid}>
            {workspace.defaultReferenceAssets.map((asset) => (
              <article key={asset.id} style={styles.card}>
                {asset.previewDataUrl ? (
                  <Image
                    src={asset.previewDataUrl}
                    alt={asset.originalName ?? asset.id}
                    width={240}
                    height={150}
                    unoptimized
                    style={styles.previewImage}
                  />
                ) : (
                  <div style={styles.previewPlaceholder}>{copy.previewUnavailable}</div>
                )}
                <div style={styles.row}>
                  <div style={styles.column}>
                    <strong>{asset.originalName ?? asset.id}</strong>
                    <span style={styles.meta}>{formatAssetMeta(asset)}</span>
                  </div>
                  <StatusBadge label={copy.defaultBadge} tone="active" />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div style={styles.column}>
            <p style={styles.meta}>{copy.defaultEmpty}</p>
            <Link href={`/projects/${projectId}/assets`} style={styles.secondaryAction}>
              {copy.openAssets}
            </Link>
          </div>
        )}
      </section>

      <section style={styles.panel}>
        <div style={styles.header}>
          <h2 style={styles.heading}>{copy.inputHeading}</h2>
          <p style={styles.description}>{copy.selectedCountPrefix}{selectedReferenceIds.length}</p>
        </div>
        <div style={styles.row}>
          <strong>{copy.referenceHeading}</strong>
          <StatusBadge
            label={isUsingTemporarySelection ? copy.temporaryOverride : copy.defaultBadge}
            tone={isUsingTemporarySelection ? "warning" : "active"}
          />
        </div>
        {referenceAssets.length === 0 ? (
          <p style={styles.meta}>{copy.noReferences}</p>
        ) : (
          <div style={styles.grid}>
            {referenceAssets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => toggleReferenceAsset(asset.id)}
                disabled={isBusy}
                style={selectedReferenceIds.includes(asset.id) ? styles.selectedCard : styles.card}
              >
                {asset.previewDataUrl ? (
                  <Image
                    src={asset.previewDataUrl}
                    alt={`Reference ${asset.id}`}
                    width={240}
                    height={150}
                    unoptimized
                    style={styles.previewImage}
                  />
                ) : (
                  <div style={styles.previewPlaceholder}>{copy.previewUnavailable}</div>
                )}
                <div style={styles.column}>
                  <strong>{asset.originalName ?? asset.id}</strong>
                  <span style={styles.meta}>{formatAssetMeta(asset)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
        <label style={styles.column}>
          <span>{copy.promptLabel}</span>
          <textarea
            aria-label="视频提示词输入框"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={isBusy}
            placeholder={copy.promptPlaceholder}
            style={styles.textarea}
            rows={4}
          />
        </label>
        <div style={styles.row}>
          {selectedReferenceIds.length > 0 && isUsingTemporarySelection ? (
            <button type="button" onClick={() => void promoteDefault()} disabled={isBusy} style={styles.secondaryButton}>
              {copy.promoteDefault}
            </button>
          ) : null}
          <button type="button" onClick={() => void submit()} disabled={!canSubmit} style={styles.primaryButton}>
            {copy.generate}
          </button>
          {activeTaskId ? <span style={styles.meta}>{copy.taskPrefix}{activeTaskId}</span> : null}
        </div>
      </section>

      <section style={styles.panel}>
        <div style={styles.header}>
          <h2 style={styles.heading}>{copy.resultsHeading}</h2>
          <p style={styles.description}>提交后会持续轮询任务状态，并在成功后自动刷新视频结果。</p>
        </div>
        {activeTaskId ? (
          <article style={styles.card}>
            <strong>{activeTaskId}</strong>
            <span style={styles.meta}>{copy.statusPrefix}{formatTaskStatus(task?.status ?? "QUEUED")}</span>
          </article>
        ) : null}
        {recentTasks.length > 0 ? (
          <div style={styles.column}>
            {recentTasks.map((taskItem) => (
              <article key={taskItem.id} style={styles.card}>
                <strong>{taskItem.id}</strong>
                <span style={styles.meta}>{formatTaskStatus(taskItem.status)} · {new Date(taskItem.createdAt).toLocaleString("zh-CN")}</span>
                {taskItem.errorText ? <span style={styles.errorText}>{taskItem.errorText}</span> : null}
              </article>
            ))}
          </div>
        ) : null}
        {videoAssets.length === 0 ? (
          <p style={styles.meta}>{copy.noResults}</p>
        ) : (
          <div style={styles.grid}>
            {videoAssets.map((asset) => (
              <article key={asset.id} style={styles.card}>
                {asset.previewUrl || asset.previewDataUrl ? (
                  <video controls preload="metadata" style={styles.video} src={asset.previewUrl ?? asset.previewDataUrl ?? undefined} />
                ) : (
                  <div style={styles.previewPlaceholder}>{copy.previewUnavailable}</div>
                )}
                <strong>{asset.id}</strong>
                <span style={styles.meta}>{formatAssetMeta(asset)}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const styles = {
  page: { display: "grid", gap: "24px" },
  panel: { display: "grid", gap: "16px", padding: "22px", borderRadius: "24px", border: "1px solid var(--border)", background: "rgba(22, 24, 39, 0.88)", boxShadow: "var(--shadow-panel)" },
  header: { display: "grid", gap: "8px" },
  heading: { margin: 0, fontSize: "1.2rem" },
  description: { margin: 0, color: "var(--text-muted)", lineHeight: 1.6 },
  notice: { margin: 0, padding: "16px 18px", borderRadius: "18px", border: "1px solid rgba(74, 222, 128, 0.2)", background: "rgba(21, 128, 61, 0.16)", color: "#dcfce7" },
  error: { margin: 0, padding: "16px 18px", borderRadius: "18px", border: "1px solid rgba(248, 113, 113, 0.24)", background: "rgba(127, 29, 29, 0.24)", color: "#fecaca" },
  support: { display: "grid", gap: "10px" },
  supportHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" },
  supportTitle: { margin: 0, fontSize: "1.15rem", lineHeight: 1.4 },
  supportBody: { margin: 0, color: "var(--text-muted)", lineHeight: 1.7 },
  metaLabel: { color: "var(--text-muted)", fontSize: "0.82rem", letterSpacing: "0.08em", textTransform: "uppercase" },
  secondaryAction: { display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: "42px", padding: "0 18px", borderRadius: "999px", background: "rgba(248, 250, 252, 0.08)", border: "1px solid rgba(248, 250, 252, 0.12)", color: "var(--text)", textDecoration: "none", fontWeight: 700 },
  row: { display: "flex", gap: "12px", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" },
  column: { display: "grid", gap: "6px", textAlign: "left" },
  grid: { display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" },
  card: { display: "grid", gap: "8px", padding: "10px", borderRadius: "18px", border: "1px solid rgba(129, 140, 248, 0.16)", background: "rgba(8, 10, 26, 0.26)", color: "var(--text)", textAlign: "left" },
  selectedCard: { display: "grid", gap: "8px", padding: "10px", borderRadius: "18px", border: "1px solid rgba(202, 138, 4, 0.55)", boxShadow: "0 0 0 2px rgba(202, 138, 4, 0.12)", background: "rgba(8, 10, 26, 0.26)", color: "var(--text)", textAlign: "left" },
  previewImage: { width: "100%", height: "150px", objectFit: "cover", borderRadius: "14px", border: "1px solid rgba(129, 140, 248, 0.16)" },
  previewPlaceholder: { width: "100%", height: "150px", display: "grid", placeItems: "center", borderRadius: "14px", border: "1px dashed rgba(129, 140, 248, 0.26)", background: "rgba(15, 23, 42, 0.52)", color: "var(--text-muted)" },
  textarea: { width: "100%", minHeight: "120px", borderRadius: "18px", border: "1px solid rgba(129, 140, 248, 0.2)", padding: "14px 16px", font: "inherit", color: "var(--text)", background: "rgba(8, 10, 26, 0.4)", resize: "vertical" },
  primaryButton: { display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: "42px", padding: "0 18px", borderRadius: "999px", border: 0, background: "linear-gradient(135deg, rgba(109, 94, 252, 0.95), rgba(129, 140, 248, 0.72))", color: "#fff", fontWeight: 700, cursor: "pointer" },
  secondaryButton: { display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: "42px", padding: "0 18px", borderRadius: "999px", border: "1px solid rgba(248, 250, 252, 0.12)", background: "rgba(248, 250, 252, 0.08)", color: "var(--text)", fontWeight: 700, cursor: "pointer" },
  meta: { color: "var(--text-muted)", lineHeight: 1.6, wordBreak: "break-word" },
  errorText: { color: "#fecaca", lineHeight: 1.6 },
  video: { width: "100%", height: "220px", borderRadius: "16px", border: "1px solid rgba(129, 140, 248, 0.16)", background: "#000", objectFit: "cover" },
} satisfies Record<string, CSSProperties>;
