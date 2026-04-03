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

type ScriptVersionSummary = {
  id: string;
  versionNumber: number;
  body?: string | null;
  createdAt: string;
};

type StoryboardWorkspaceResponse = {
  project: {
    id: string;
    title: string;
    idea?: string | null;
  };
  scriptVersions: ScriptVersionSummary[];
};

type StoryboardPageData = {
  id: string;
  title: string;
  idea?: string | null;
  scriptVersions: ScriptVersionSummary[];
};

const copy = {
  workflowTitle: "项目制作流程",
  stageTitle: "分镜",
  stageDescription:
    "选择一个已定稿脚本，把内容拆成 15 秒镜头段落，并保留可直接复制的视频提示词。",
  projectLabel: "当前项目",
  backToProject: "返回项目制作台",
  activeStage: "当前阶段",
  noIdea: "项目还没有补充创意说明，先确认脚本版本内容再继续分镜。",
  scriptStage: "脚本",
  storyboardStage: "分镜",
  imagesStage: "图片",
  videosStage: "视频",
  stageDone: "已完成",
  stageActive: "进行中",
  stageNext: "下一步",
  stageWaiting: "待开始",
  scriptVersionsHeading: "脚本版本",
  scriptVersionsDescription:
    "这里只显示当前项目的脚本版本，选中后即可发起分镜拆解任务。",
  selectScriptVersion: "选择脚本版本",
  scriptVersionsEmpty: "当前项目还没有脚本版本，先完成脚本定稿。",
  noScriptBody: "当前版本没有保存剧本正文。",
  generateStoryboard: "生成分镜",
  statusHeading: "任务状态",
  statusDescription:
    "发起分镜任务后，这里会显示当前轮询到的任务状态与结果摘要。",
  noTask: "当前没有正在运行的分镜任务。",
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
  selectVersionValidation: "请选择一个脚本版本后再生成分镜。",
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
  scriptDetail: "脚本完成后，可在这里拆分镜头节奏。",
  storyboardDetail: "根据定稿脚本生成 15 秒分镜。",
  imagesDetail: "把分镜转成关键画面与参考图。",
  videosDetail: "用关键画面推进视频镜头生成。",
  enterScript: "前往脚本",
  enterStoryboard: "继续分镜",
  enterImages: "前往图片",
  enterVideos: "前往视频",
  versionPrefix: "版本",
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

export default function ProjectStoryboardPage() {
  const params = useParams<{ projectId: string }>();
  const [projectId, setProjectId] = useState("");
  const [project, setProject] = useState<StoryboardPageData | null>(null);
  const [selectedScriptVersionId, setSelectedScriptVersionId] = useState<
    string | null
  >(null);
  const [storyboardResult, setStoryboardResult] =
    useState<StoryboardTaskOutput | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingProject, setIsLoadingProject] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
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

        if (!cancelled && payload && "project" in payload) {
          setProject({
            id: payload.project.id,
            title: payload.project.title,
            idea: payload.project.idea ?? null,
            scriptVersions: payload.scriptVersions,
          });
          setSelectedScriptVersionId((current) => {
            const currentVersionStillExists =
              current &&
              payload.scriptVersions.some((version) => version.id === current);

            return currentVersionStillExists
              ? current
              : payload.scriptVersions[0]?.id ?? null;
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

  const selectedScriptVersion = useMemo(() => {
    if (!project || !selectedScriptVersionId) {
      return null;
    }

    return (
      project.scriptVersions.find(
        (version) => version.id === selectedScriptVersionId,
      ) ?? null
    );
  }, [project, selectedScriptVersionId]);

  const storyboardSegments = storyboardResult?.segments ?? [];
  const isBusy = isLoadingProject || isSubmitting || Boolean(activeTaskId);
  const canGenerate = Boolean(projectId && selectedScriptVersionId && !isBusy);

  async function handleGenerateStoryboard() {
    if (!projectId || !selectedScriptVersionId) {
      setError(copy.selectVersionValidation);
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
  const scriptVersionSummary = project?.scriptVersions.length
    ? `已载入 ${project.scriptVersions.length} 个脚本版本。`
    : "等待脚本定稿后再开始分镜。";

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
              {isLoadingProject
                ? copy.loadingProject
                : project?.title ?? copy.loadingProject}
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
            detail: scriptVersionSummary,
            summary: copy.scriptDetail,
            badgeLabel: project?.scriptVersions.length
              ? copy.stageDone
              : copy.stageWaiting,
            tone: project?.scriptVersions.length ? "active" : "neutral",
            href: `/projects/${projectId}/script`,
            ctaLabel: copy.enterScript,
          },
          {
            label: copy.storyboardStage,
            detail: storyboardSegments.length
              ? `已生成 ${storyboardSegments.length} 段分镜。`
              : copy.storyboardDetail,
            summary: selectedScriptVersion
              ? `当前使用脚本版本 ${selectedScriptVersion.versionNumber}。`
              : "先选择一个脚本版本。",
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
            <h2 style={sectionTitleStyle}>{copy.scriptVersionsHeading}</h2>
            <p style={sectionDescriptionStyle}>{copy.scriptVersionsDescription}</p>
          </div>

          {project?.scriptVersions?.length ? (
            <label style={fieldStyle}>
              <span style={fieldLabelStyle}>{copy.selectScriptVersion}</span>
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
                    {copy.versionPrefix} {version.versionNumber} ·{" "}
                    {new Date(version.createdAt).toLocaleString("zh-CN")}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p style={emptyStateStyle}>{copy.scriptVersionsEmpty}</p>
          )}

          {selectedScriptVersion ? (
            <article style={resultCardStyle}>
              <p style={resultMetaStyle}>
                {copy.versionPrefix} {selectedScriptVersion.versionNumber}
              </p>
              <pre style={outputPreStyle}>
                {selectedScriptVersion.body?.trim() || copy.noScriptBody}
              </pre>
            </article>
          ) : null}

          <button
            type="button"
            aria-label="Generate storyboard"
            onClick={handleGenerateStoryboard}
            style={primaryButtonStyle}
            disabled={!canGenerate}
          >
            {copy.generateStoryboard}
          </button>
        </section>

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
                {storyboardSegments.length} 段
              </strong>
            </article>
          ) : null}
        </section>
      </div>

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
