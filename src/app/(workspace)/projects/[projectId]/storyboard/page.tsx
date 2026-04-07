"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import PageHero from "@/components/studio/page-hero";
import StatusBadge from "@/components/studio/status-badge";
import WorkflowRail from "@/components/studio/workflow-rail";
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

type StoryboardScriptAsset = {
  id: string;
  originalName: string;
  category: "script_source" | "script_generated";
  origin: "upload" | "system";
  createdAt: string;
  extractedText: string;
  scriptVersionId: string | null;
};

type StoryboardWorkspaceResponse = {
  project: {
    id: string;
    title: string;
    idea?: string | null;
  };
  binding: {
    storyboardScriptAssetId: string | null;
  };
  defaultScriptAsset: StoryboardScriptAsset | null;
  scriptAssets: StoryboardScriptAsset[];
};

type StoryboardPageData = {
  id: string;
  title: string;
  idea?: string | null;
  binding: {
    storyboardScriptAssetId: string | null;
  };
  defaultScriptAsset: StoryboardScriptAsset | null;
  scriptAssets: StoryboardScriptAsset[];
};

const copy = {
  workflowTitle: "项目制作流程",
  stageTitle: "分镜",
  stageDescription:
    "从资产中心读取当前剧本资产，将正文拆分成 15 秒镜头段落，并保留后续可直接复用的视频提示词。",
  projectLabel: "当前项目",
  backToProject: "返回项目制作台",
  activeStage: "当前阶段",
  noIdea: "项目还没有补充创意说明，确认剧本资产后即可继续分镜。",
  scriptStage: "脚本",
  storyboardStage: "分镜",
  imagesStage: "图片",
  videosStage: "视频",
  stageDone: "已准备",
  stageActive: "进行中",
  stageNext: "下一步",
  stageWaiting: "待开始",
  defaultBindingHeading: "当前默认剧本资产",
  defaultBindingDescription:
    "分镜页优先读取项目级默认剧本资产；如需临时改选，可在本页覆盖，不会自动改写默认绑定。",
  defaultBindingEmpty: "当前未设置默认剧本资产",
  inputHeading: "本次分镜输入",
  inputDescription:
    "可从当前项目中已就绪的剧本资产里切换本次输入。上传剧本与系统定稿都能直接用于分镜。",
  selectScriptAsset: "选择本次分镜剧本",
  scriptAssetsEmpty: "当前项目还没有可用于分镜的剧本资产，请先在资产中心上传剧本或完成脚本定稿。",
  temporaryOverride: "仅本次使用",
  defaultBindingBadge: "当前默认输入",
  promoteDefault: "设为该流程默认输入",
  promoteSuccess: "已更新分镜默认剧本资产。",
  promoteFailed: "更新分镜默认剧本资产失败",
  generateStoryboard: "生成分镜",
  statusHeading: "任务状态",
  statusDescription:
    "发起分镜任务后，这里会持续显示当前状态与结果摘要，便于确认是否已可进入下一阶段。",
  noTask: "当前没有正在执行的分镜任务。",
  generatedSegments: "生成段数",
  segmentsHeading: "分镜结果",
  segmentsDescription:
    "每段分镜保留场景、景别、动作、对白和视频提示词，便于继续进入图片和视频流程。",
  segmentsEmpty: "分镜任务完成后，结果会显示在这里。",
  taskIdLabel: "任务 ID",
  loadingProject: "加载项目中...",
  loadProjectFailed: "加载项目失败",
  fetchTaskFailed: "获取任务状态失败",
  generating: "正在生成分镜...",
  queued: "分镜任务已加入队列。",
  generated: "分镜已生成。",
  failed: "分镜生成失败",
  selectAssetValidation: "请先选择一个可用的剧本资产。",
  requestFailed: "分镜任务提交失败",
  copyFailed: "复制视频提示词失败",
  copied: "已复制",
  copyPrompt: "复制提示词",
  sceneLabel: "场景",
  shotLabel: "景别",
  actionLabel: "动作",
  dialogueLabel: "对白",
  promptLabel: "视频提示词",
  noDialogue: "无对白",
  scriptDetail: "资产中心中的就绪剧本会直接出现在这里。",
  storyboardDetail: "按剧本资产拆分 15 秒分镜。",
  imagesDetail: "把分镜继续转成关键画面与参考图。",
  videosDetail: "基于关键画面推进视频镜头生成。",
  enterScript: "前往脚本",
  enterStoryboard: "继续分镜",
  enterImages: "前往图片",
  enterVideos: "前往视频",
  segmentPrefix: "第",
  segmentSuffix: "段",
  secondsSuffix: "秒",
  statusPrefix: "任务状态：",
} as const;

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

function formatAssetOptionLabel(asset: StoryboardScriptAsset) {
  const originLabel = asset.origin === "system" ? "系统定稿" : "上传剧本";
  return `${asset.originalName} · ${originLabel} · ${new Date(asset.createdAt).toLocaleString("zh-CN")}`;
}

function formatAssetOrigin(asset: StoryboardScriptAsset) {
  return asset.origin === "system" ? "系统剧本" : "上传剧本";
}

export default function ProjectStoryboardPage() {
  const params = useParams<{ projectId: string }>();
  const [projectId, setProjectId] = useState("");
  const [project, setProject] = useState<StoryboardPageData | null>(null);
  const [selectedScriptAssetId, setSelectedScriptAssetId] = useState<string | null>(
    null,
  );
  const [storyboardResult, setStoryboardResult] =
    useState<StoryboardTaskOutput | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingProject, setIsLoadingProject] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPromotingDefault, setIsPromotingDefault] = useState(false);
  const [copiedSegmentIndex, setCopiedSegmentIndex] = useState<number | null>(
    null,
  );
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
        const response = await fetch(`/api/storyboards?projectId=${projectId}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as
          | StoryboardWorkspaceResponse
          | { error?: string }
          | null;

        if (!response.ok) {
          throw new Error(
            payload && "error" in payload
              ? payload.error ?? copy.loadProjectFailed
              : copy.loadProjectFailed,
          );
        }

        if (
          !cancelled &&
          payload &&
          "project" in payload &&
          "scriptAssets" in payload &&
          "binding" in payload
        ) {
          setProject({
            id: payload.project.id,
            title: payload.project.title,
            idea: payload.project.idea ?? null,
            binding: payload.binding,
            defaultScriptAsset: payload.defaultScriptAsset,
            scriptAssets: payload.scriptAssets,
          });
          setSelectedScriptAssetId((current) => {
            const currentAssetStillExists =
              current &&
              payload.scriptAssets.some((asset) => asset.id === current);

            return currentAssetStillExists
              ? current
              : payload.binding.storyboardScriptAssetId ??
                  payload.scriptAssets[0]?.id ??
                  null;
          });
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : copy.loadProjectFailed,
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
      setStoryboardResult(polledTask.outputJson ?? null);
      setStatusMessage(copy.generated);
      setError(null);
      setActiveTaskId(null);
      return;
    }

    if (polledTask.status === "FAILED" || polledTask.status === "CANCELED") {
      setStoryboardResult(null);
      setStatusMessage(null);
      setError(polledTask.errorText ?? copy.failed);
      setActiveTaskId(null);
    }
  }, [activeTaskId, task]);

  const selectedScriptAsset = useMemo(() => {
    if (!project || !selectedScriptAssetId) {
      return null;
    }

    return (
      project.scriptAssets.find((asset) => asset.id === selectedScriptAssetId) ?? null
    );
  }, [project, selectedScriptAssetId]);

  const storyboardSegments = storyboardResult?.segments ?? [];
  const isBusy =
    isLoadingProject ||
    isSubmitting ||
    isPromotingDefault ||
    Boolean(activeTaskId);
  const defaultScriptAssetId = project?.binding.storyboardScriptAssetId ?? null;
  const isUsingTemporarySelection = Boolean(
    selectedScriptAssetId && selectedScriptAssetId !== defaultScriptAssetId,
  );
  const canPromoteDefault = Boolean(
    selectedScriptAssetId &&
      selectedScriptAssetId !== defaultScriptAssetId &&
      !isBusy,
  );
  const canGenerate = Boolean(projectId && selectedScriptAssetId && !isBusy);

  async function handleGenerateStoryboard() {
    if (!projectId || !selectedScriptAssetId) {
      setError(copy.selectAssetValidation);
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
          scriptAssetId: selectedScriptAssetId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { taskId?: string; error?: string }
        | null;

      if (!response.ok || !payload?.taskId) {
        throw new Error(payload?.error ?? copy.requestFailed);
      }

      setActiveTaskId(payload.taskId);
      setStatusMessage(copy.queued);
    } catch (submitError) {
      setStatusMessage(null);
      setError(
        submitError instanceof Error ? submitError.message : copy.requestFailed,
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePromoteDefault() {
    if (!projectId || !selectedScriptAsset) {
      return;
    }

    setError(null);
    setStatusMessage(null);
    setIsPromotingDefault(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/workflow-binding`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          storyboardScriptAssetId: selectedScriptAsset.id,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            storyboardScriptAssetId?: string | null;
            error?: string;
          }
        | null;

      if (!response.ok || !payload || !("storyboardScriptAssetId" in payload)) {
        throw new Error(payload?.error ?? copy.promoteFailed);
      }

      setProject((current) => {
        if (!current) {
          return current;
        }

        const nextDefaultAsset =
          current.scriptAssets.find(
            (asset) => asset.id === payload.storyboardScriptAssetId,
          ) ?? null;

        return {
          ...current,
          binding: {
            storyboardScriptAssetId: payload.storyboardScriptAssetId ?? null,
          },
          defaultScriptAsset: nextDefaultAsset,
        };
      });
      setStatusMessage(copy.promoteSuccess);
    } catch (promoteError) {
      setError(
        promoteError instanceof Error ? promoteError.message : copy.promoteFailed,
      );
    } finally {
      setIsPromotingDefault(false);
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
      setError(copy.copyFailed);
    }
  }

  const projectSummary = project?.idea?.trim() || copy.noIdea;
  const scriptAssetSummary = project?.scriptAssets.length
    ? `已就绪 ${project.scriptAssets.length} 个剧本资产。`
    : "等待可用剧本资产。";
  const heroProjectTitle = isLoadingProject
    ? copy.loadingProject
    : project?.title ?? copy.stageTitle;

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
            detail: scriptAssetSummary,
            summary: copy.scriptDetail,
            badgeLabel: project?.scriptAssets.length
              ? copy.stageDone
              : copy.stageWaiting,
            tone: project?.scriptAssets.length ? "active" : "neutral",
            href: `/projects/${projectId}/script`,
            ctaLabel: copy.enterScript,
          },
          {
            label: copy.storyboardStage,
            detail: storyboardSegments.length
              ? `已生成 ${storyboardSegments.length} 段分镜。`
              : copy.storyboardDetail,
            summary: selectedScriptAsset
              ? `当前输入：${selectedScriptAsset.originalName}`
              : "先选择一个剧本资产。",
            badgeLabel: copy.stageActive,
            tone: "active",
            href: `/projects/${projectId}/storyboard`,
            ctaLabel: copy.enterStoryboard,
          },
          {
            label: copy.imagesStage,
            detail: copy.imagesDetail,
            summary: storyboardSegments.length
              ? "分镜已就绪，可以继续生成关键画面。"
              : "等待分镜结果输出后继续。",
            badgeLabel: storyboardSegments.length
              ? copy.stageNext
              : copy.stageWaiting,
            tone: storyboardSegments.length ? "warning" : "neutral",
            href: `/projects/${projectId}/images`,
            ctaLabel: copy.enterImages,
          },
          {
            label: copy.videosStage,
            detail: copy.videosDetail,
            summary: "在关键画面确认后继续进入视频生成。",
            badgeLabel: copy.stageWaiting,
            tone: "neutral",
            href: `/projects/${projectId}/videos`,
            ctaLabel: copy.enterVideos,
          },
        ]}
      />

      {error ? (
        <p role="alert" style={errorNoticeStyle}>
          {error}
        </p>
      ) : null}
      {statusMessage ? (
        <p role="status" style={statusNoticeStyle}>
          {statusMessage}
        </p>
      ) : null}

      <div style={twoColumnGridStyle}>
        <section style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <h2 style={sectionTitleStyle}>{copy.defaultBindingHeading}</h2>
            <p style={sectionDescriptionStyle}>{copy.defaultBindingDescription}</p>
          </div>

          {project?.defaultScriptAsset ? (
            <article style={resultCardStyle}>
              <div style={cardHeaderStyle}>
                <div style={cardHeaderCopyStyle}>
                  <p style={resultMetaStyle}>{copy.defaultBindingHeading}</p>
                  <strong style={resultTitleStyle}>
                    {project.defaultScriptAsset.originalName}
                  </strong>
                </div>
                <StatusBadge label={copy.defaultBindingBadge} tone="active" />
              </div>
              <p style={resultBodyStyle}>
                {formatAssetOrigin(project.defaultScriptAsset)} ·{" "}
                {new Date(project.defaultScriptAsset.createdAt).toLocaleString("zh-CN")}
              </p>
              <pre style={outputPreStyle}>
                {project.defaultScriptAsset.extractedText}
              </pre>
            </article>
          ) : (
            <p style={emptyStateStyle}>{copy.defaultBindingEmpty}</p>
          )}
        </section>

        <section style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <h2 style={sectionTitleStyle}>{copy.inputHeading}</h2>
            <p style={sectionDescriptionStyle}>{copy.inputDescription}</p>
          </div>

          {project?.scriptAssets.length ? (
            <>
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>{copy.selectScriptAsset}</span>
                <select
                  aria-label={copy.selectScriptAsset}
                  value={selectedScriptAssetId ?? ""}
                  onChange={(event) => {
                    setSelectedScriptAssetId(event.target.value || null);
                    setStoryboardResult(null);
                    setStatusMessage(null);
                  }}
                  style={selectStyle}
                  disabled={isBusy}
                >
                  {project.scriptAssets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {formatAssetOptionLabel(asset)}
                    </option>
                  ))}
                </select>
              </label>

              {selectedScriptAsset ? (
                <article style={resultCardStyle}>
                  <div style={cardHeaderStyle}>
                    <div style={cardHeaderCopyStyle}>
                      <p style={resultMetaStyle}>{copy.inputHeading}</p>
                      <strong style={resultTitleStyle}>
                        {selectedScriptAsset.originalName}
                      </strong>
                    </div>
                    <StatusBadge
                      label={
                        isUsingTemporarySelection
                          ? copy.temporaryOverride
                          : copy.defaultBindingBadge
                      }
                      tone={isUsingTemporarySelection ? "warning" : "active"}
                    />
                  </div>
                  <p style={resultBodyStyle}>
                    {formatAssetOrigin(selectedScriptAsset)} ·{" "}
                    {new Date(selectedScriptAsset.createdAt).toLocaleString("zh-CN")}
                  </p>
                  <pre style={outputPreStyle}>{selectedScriptAsset.extractedText}</pre>
                </article>
              ) : null}

              <div style={actionRowStyle}>
                {canPromoteDefault ? (
                  <button
                    type="button"
                    onClick={() => void handlePromoteDefault()}
                    style={secondaryButtonStyle}
                    disabled={!canPromoteDefault}
                  >
                    {copy.promoteDefault}
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label={copy.generateStoryboard}
                  onClick={() => void handleGenerateStoryboard()}
                  style={primaryButtonStyle}
                  disabled={!canGenerate}
                >
                  {copy.generateStoryboard}
                </button>
              </div>
            </>
          ) : (
            <p style={emptyStateStyle}>{copy.scriptAssetsEmpty}</p>
          )}
        </section>
      </div>

      <section style={panelStyle}>
        <div style={sectionHeaderStyle}>
          <h2 style={sectionTitleStyle}>{copy.statusHeading}</h2>
          <p style={sectionDescriptionStyle}>{copy.statusDescription}</p>
        </div>

        {activeTaskId ? (
          <article style={resultCardStyle}>
            <p style={resultMetaStyle}>{copy.taskIdLabel}</p>
            <strong style={resultTitleStyle}>{activeTaskId}</strong>
            <p style={resultBodyStyle}>
              {copy.statusPrefix}
              {formatTaskStatus(task?.status ?? "QUEUED")}
            </p>
          </article>
        ) : (
          <p style={emptyStateStyle}>{copy.noTask}</p>
        )}

        {storyboardSegments.length > 0 ? (
          <article style={resultCardStyle}>
            <p style={resultMetaStyle}>{copy.generatedSegments}</p>
            <strong style={resultTitleStyle}>
              {storyboardSegments.length} {copy.segmentSuffix}
            </strong>
          </article>
        ) : null}
      </section>

      <section style={panelStyle}>
        <div style={sectionHeaderStyle}>
          <h2 style={sectionTitleStyle}>{copy.segmentsHeading}</h2>
          <p style={sectionDescriptionStyle}>{copy.segmentsDescription}</p>
        </div>

        {storyboardSegments.length === 0 ? (
          <p style={emptyStateStyle}>{copy.segmentsEmpty}</p>
        ) : (
          <div style={segmentGridStyle}>
            {storyboardSegments.map((segment) => (
              <article key={segment.index} style={segmentCardStyle}>
                <div style={segmentHeaderStyle}>
                  <div style={segmentHeaderCopyStyle}>
                    <p style={resultMetaStyle}>
                      {copy.segmentPrefix}
                      {segment.index}
                      {copy.segmentSuffix}
                    </p>
                    <strong style={resultTitleStyle}>
                      {segment.durationSeconds}
                      {copy.secondsSuffix}
                    </strong>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopyVideoPrompt(segment)}
                    style={secondaryButtonStyle}
                  >
                    {copiedSegmentIndex === segment.index
                      ? copy.copied
                      : copy.copyPrompt}
                  </button>
                </div>

                <div style={segmentFieldsStyle}>
                  <div>
                    <p style={segmentFieldLabelStyle}>{copy.sceneLabel}</p>
                    <p style={segmentFieldValueStyle}>{segment.scene}</p>
                  </div>
                  <div>
                    <p style={segmentFieldLabelStyle}>{copy.shotLabel}</p>
                    <p style={segmentFieldValueStyle}>{segment.shot}</p>
                  </div>
                  <div>
                    <p style={segmentFieldLabelStyle}>{copy.actionLabel}</p>
                    <p style={segmentFieldValueStyle}>{segment.action}</p>
                  </div>
                  <div>
                    <p style={segmentFieldLabelStyle}>{copy.dialogueLabel}</p>
                    <p style={segmentFieldValueStyle}>
                      {segment.dialogue || copy.noDialogue}
                    </p>
                  </div>
                  <div>
                    <p style={segmentFieldLabelStyle}>{copy.promptLabel}</p>
                    <pre style={promptPreStyle}>{segment.videoPrompt}</pre>
                  </div>
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

const actionRowStyle = {
  display: "flex",
  gap: "12px",
  flexWrap: "wrap",
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

const emptyStateStyle = {
  margin: 0,
  color: "var(--text-muted)",
  lineHeight: 1.7,
} satisfies CSSProperties;

const resultCardStyle = {
  display: "grid",
  gap: "8px",
  padding: "16px",
  borderRadius: "18px",
  border: "1px solid rgba(129, 140, 248, 0.16)",
  background: "rgba(8, 10, 26, 0.26)",
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

const resultMetaStyle = {
  margin: 0,
  color: "var(--accent-gold)",
  fontSize: "0.8rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
} satisfies CSSProperties;

const resultTitleStyle = {
  fontSize: "1rem",
  lineHeight: 1.6,
} satisfies CSSProperties;

const resultBodyStyle = {
  margin: 0,
  color: "var(--text-muted)",
  lineHeight: 1.7,
  whiteSpace: "pre-wrap",
} satisfies CSSProperties;

const outputPreStyle = {
  margin: 0,
  padding: "18px",
  borderRadius: "18px",
  border: "1px solid rgba(129, 140, 248, 0.16)",
  background: "rgba(8, 10, 26, 0.32)",
  color: "var(--text)",
  whiteSpace: "pre-wrap",
  lineHeight: 1.8,
} satisfies CSSProperties;

const segmentGridStyle = {
  display: "grid",
  gap: "16px",
} satisfies CSSProperties;

const segmentCardStyle = {
  display: "grid",
  gap: "16px",
  padding: "18px",
  borderRadius: "20px",
  border: "1px solid rgba(129, 140, 248, 0.16)",
  background: "rgba(8, 10, 26, 0.26)",
} satisfies CSSProperties;

const segmentHeaderStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  flexWrap: "wrap",
} satisfies CSSProperties;

const segmentHeaderCopyStyle = {
  display: "grid",
  gap: "6px",
} satisfies CSSProperties;

const segmentFieldsStyle = {
  display: "grid",
  gap: "14px",
} satisfies CSSProperties;

const segmentFieldLabelStyle = {
  margin: 0,
  color: "var(--accent-gold)",
  fontSize: "0.78rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
} satisfies CSSProperties;

const segmentFieldValueStyle = {
  margin: "6px 0 0",
  color: "var(--text)",
  lineHeight: 1.7,
} satisfies CSSProperties;

const promptPreStyle = {
  margin: "6px 0 0",
  padding: "14px",
  borderRadius: "16px",
  background: "rgba(15, 23, 42, 0.52)",
  border: "1px solid rgba(129, 140, 248, 0.16)",
  color: "var(--text)",
  whiteSpace: "pre-wrap",
  lineHeight: 1.7,
} satisfies CSSProperties;
