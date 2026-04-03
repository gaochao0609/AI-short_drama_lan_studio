"use client";

import type { CSSProperties } from "react";
import { startTransition, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import PageHero from "@/components/studio/page-hero";
import StatusBadge from "@/components/studio/status-badge";
import WorkflowRail from "@/components/studio/workflow-rail";
import useTaskPolling from "@/hooks/useTaskPolling";

type QuestionItem = {
  id: string;
  text: string;
  answer?: string;
};

type TaskPollResponse = {
  id: string;
  status: string;
  outputJson?: {
    scriptVersionId?: string;
    body?: string;
  } | null;
  errorText?: string | null;
};

type ProjectResponse = {
  id: string;
  title: string;
  idea?: string | null;
};

type SseEventMessage = {
  event: string;
  data: string;
};

const copy = {
  workflowTitle: "项目制作流程",
  stageTitle: "脚本",
  stageDescription:
    "通过多轮问答把项目想法整理成可定稿的短剧剧本，再交给后台任务队列完成最终定稿。",
  projectLabel: "当前项目",
  noIdea: "还没有填写项目创意，先补一句故事方向，再开始脚本问答。",
  activeStage: "当前阶段",
  backToProject: "返回项目制作台",
  scriptStage: "脚本",
  storyboardStage: "分镜",
  imagesStage: "图片",
  videosStage: "视频",
  stageActive: "进行中",
  stageNext: "下一步",
  stageWaiting: "待开始",
  startIdeaHeading: "创意输入",
  startIdeaDescription:
    "先写下故事核心想法，系统会围绕角色、冲突和世界设定连续追问。",
  ideaLabel: "项目创意",
  startSession: "开始脚本会话",
  resetSession: "重新开始",
  questionsHeading: "问答记录",
  questionsDescription:
    "每一轮提问都会保留在这里，便于继续追问、回看和定稿前检查。",
  questionEmpty: "脚本会话开始后，AI 的问题会显示在这里。",
  answerLabel: "本轮回答",
  sendAnswer: "发送回答",
  regenerateQuestion: "重新生成当前问题",
  finalize: "定稿剧本",
  finalScriptHeading: "定稿结果",
  finalScriptDescription:
    "定稿后页面会持续轮询任务状态，成功时把最终剧本正文展示在这里。",
  finalScriptEmpty: "还没有生成最终剧本。",
  streamingLabel: "实时生成中",
  roundPrefix: "第",
  roundSuffix: "轮",
  answerPrefix: "回答：",
  loadingProject: "加载项目中...",
  finalizeRunning: "正在生成最终剧本...",
  finalizeSuccess: "最终剧本已生成。",
  finalizeFailed: "剧本定稿任务失败",
  loadProjectFailed: "加载项目失败",
  fetchTaskFailed: "获取任务状态失败",
  streamRequestFailed: "脚本会话请求失败",
  streamFailed: "脚本流式生成失败",
  startValidation: "请先填写项目创意，再开始脚本会话。",
  startFailed: "启动脚本会话失败",
  answerValidation: "请输入回答后再继续。",
  answerFailed: "提交回答失败",
  regenerateFailed: "重新生成问题失败",
  finalizeFailedRequest: "剧本定稿失败",
  scriptDetailInitial: "通过问答细化人物、冲突和情绪节奏。",
  storyboardDetail: "把定稿剧本拆成 15 秒分镜段落。",
  imagesDetail: "根据分镜提示生成关键画面。",
  videosDetail: "把关键画面推进成视频镜头。",
  enterScript: "继续脚本",
  enterStoryboard: "前往分镜",
  enterImages: "前往图片",
  enterVideos: "前往视频",
} as const;

function parseSseMessages(buffer: string) {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const messages: SseEventMessage[] = [];

  for (const part of parts) {
    let event = "message";
    const dataLines: string[] = [];

    for (const line of part.split("\n")) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    messages.push({
      event,
      data: dataLines.join("\n"),
    });
  }

  return {
    messages,
    rest,
  };
}

export default function ProjectScriptPage() {
  const params = useParams<{ projectId: string }>();
  const [projectId, setProjectId] = useState("");
  const [projectTitle, setProjectTitle] = useState(copy.loadingProject);
  const [idea, setIdea] = useState("");
  const [projectIdea, setProjectIdea] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [answer, setAnswer] = useState("");
  const [streamingQuestion, setStreamingQuestion] = useState("");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [finalScript, setFinalScript] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSessionCompleted, setIsSessionCompleted] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingProject, setIsLoadingProject] = useState(true);
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
              ? payload.error ?? copy.loadProjectFailed
              : copy.loadProjectFailed,
          );
        }

        if (!cancelled && payload && "title" in payload) {
          setProjectTitle(payload.title);
          setProjectIdea(payload.idea?.trim() ?? "");
          setIdea((current) => current || payload.idea || "");
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

    setStatusMessage(null);
    setError(
      pollingError instanceof Error ? pollingError.message : copy.fetchTaskFailed,
    );
    setActiveTaskId(null);
  }, [activeTaskId, pollingError]);

  useEffect(() => {
    const polledTask = task as TaskPollResponse | undefined;

    if (!activeTaskId || !polledTask) {
      return;
    }

    if (polledTask.status === "RUNNING") {
      setStatusMessage(copy.finalizeRunning);
      setError(null);
      return;
    }

    if (polledTask.status === "SUCCEEDED") {
      setStatusMessage(copy.finalizeSuccess);
      setFinalScript(polledTask.outputJson?.body ?? "");
      setAnswer("");
      setStreamingQuestion("");
      setIsSessionCompleted(true);
      setError(null);
      setActiveTaskId(null);
      return;
    }

    if (polledTask.status === "FAILED" || polledTask.status === "CANCELED") {
      setStatusMessage(null);
      setIsSessionCompleted(false);
      setError(polledTask.errorText ?? copy.finalizeFailed);
      setActiveTaskId(null);
    }
  }, [activeTaskId, task]);

  async function consumeQuestionStream(
    response: Response,
    mode: "start" | "next" | "regenerate",
    submittedAnswer?: string,
  ) {
    if (!response.ok || !response.body) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      throw new Error(payload?.error ?? copy.streamRequestFailed);
    }

    setIsStreaming(true);
    setStreamingQuestion("");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let nextStreamingQuestion = "";

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseMessages(buffer);
        buffer = parsed.rest;

        for (const message of parsed.messages) {
          if (message.event === "session") {
            const payload = JSON.parse(message.data) as { sessionId: string };
            setSessionId(payload.sessionId);
          }

          if (message.event === "question") {
            const payload = JSON.parse(message.data) as { delta: string };
            nextStreamingQuestion += payload.delta;
            setStreamingQuestion(nextStreamingQuestion);
          }

          if (message.event === "done") {
            const payload = JSON.parse(message.data) as {
              questionText: string;
            };

            startTransition(() => {
              setQuestions((current) => {
                if (mode === "next" && current.length > 0) {
                  const previous = current.slice(0, -1);
                  const latest = current[current.length - 1];

                  return [
                    ...previous,
                    {
                      ...latest,
                      answer: submittedAnswer,
                    },
                    {
                      id: `${Date.now()}-${current.length + 1}`,
                      text: payload.questionText,
                    },
                  ];
                }

                if (mode === "regenerate" && current.length > 0) {
                  const previous = current.slice(0, -1);
                  const latest = current[current.length - 1];

                  return [
                    ...previous,
                    {
                      ...latest,
                      text: payload.questionText,
                    },
                  ];
                }

                return [
                  ...current,
                  {
                    id: `${Date.now()}-${current.length + 1}`,
                    text: payload.questionText,
                  },
                ];
              });
            });

            if (mode === "next") {
              setAnswer("");
            }

            setStreamingQuestion("");
          }

          if (message.event === "error") {
            const payload = JSON.parse(message.data) as { message?: string };
            throw new Error(payload.message ?? copy.streamFailed);
          }
        }
      }
    } catch (streamError) {
      setStreamingQuestion("");
      throw streamError;
    } finally {
      reader.releaseLock();
      setIsStreaming(false);
    }
  }

  async function handleStartSession() {
    if (!projectId || !idea.trim()) {
      setError(copy.startValidation);
      return;
    }

    setError(null);
    setStatusMessage(null);
    setIsSubmitting(true);
    setQuestions([]);
    setFinalScript("");
    setActiveTaskId(null);
    setIsSessionCompleted(false);
    setSessionId(null);

    try {
      const response = await fetch("/api/script/sessions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          projectId,
          idea,
        }),
      });

      await consumeQuestionStream(response, "start");
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : copy.startFailed,
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSendAnswer() {
    if (!sessionId || !answer.trim()) {
      setError(copy.answerValidation);
      return;
    }

    setError(null);
    setStatusMessage(null);
    setIsSubmitting(true);
    const submittedAnswer = answer;

    try {
      const response = await fetch(`/api/script/sessions/${sessionId}/message`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          answer: submittedAnswer,
        }),
      });

      await consumeQuestionStream(response, "next", submittedAnswer);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : copy.answerFailed,
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRegenerateQuestion() {
    if (!sessionId) {
      return;
    }

    setError(null);
    setStatusMessage(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/script/sessions/${sessionId}/regenerate`, {
        method: "POST",
      });

      await consumeQuestionStream(response, "regenerate");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : copy.regenerateFailed,
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleFinalize() {
    if (!sessionId) {
      return;
    }

    setError(null);
    setStatusMessage(copy.finalizeRunning);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/script/sessions/${sessionId}/finalize`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | { taskId?: string; error?: string }
        | null;

      if (!response.ok || !payload?.taskId) {
        throw new Error(payload?.error ?? copy.finalizeFailedRequest);
      }

      setActiveTaskId(payload.taskId);
    } catch (submitError) {
      setStatusMessage(null);
      setError(
        submitError instanceof Error
          ? submitError.message
          : copy.finalizeFailedRequest,
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleResetSession() {
    setSessionId(null);
    setQuestions([]);
    setAnswer("");
    setStreamingQuestion("");
    setActiveTaskId(null);
    setFinalScript("");
    setStatusMessage(null);
    setError(null);
    setIsSessionCompleted(false);
    setIdea("");
  }

  const isBusy = isSubmitting || isStreaming;
  const isFinalizePolling = Boolean(activeTaskId);
  const isSessionLocked = isBusy || isFinalizePolling;
  const isQuestionControlsLocked = isSessionLocked || isSessionCompleted;
  const projectSummary = useMemo(() => {
    if (idea.trim()) {
      return idea.trim();
    }

    if (projectIdea.trim()) {
      return projectIdea.trim();
    }

    return copy.noIdea;
  }, [idea, projectIdea]);
  const scriptSummary = finalScript
    ? "已生成最终剧本，可直接进入分镜阶段。"
    : questions.length > 0
      ? `已完成 ${questions.length} 轮问答，继续完善后可提交定稿。`
      : copy.scriptDetailInitial;

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
              {isLoadingProject ? copy.loadingProject : projectTitle}
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
            detail: scriptSummary,
            summary: finalScript
              ? "定稿结果已返回，可继续拆成分镜。"
              : "从想法提炼角色、冲突和场景节奏。",
            badgeLabel: copy.stageActive,
            tone: "active",
            href: `/projects/${projectId}/script`,
            ctaLabel: copy.enterScript,
          },
          {
            label: copy.storyboardStage,
            detail: copy.storyboardDetail,
            summary: finalScript
              ? "脚本已具备分镜输入条件。"
              : "等待脚本定稿后生成结构化镜头段落。",
            badgeLabel: finalScript ? copy.stageNext : copy.stageWaiting,
            tone: finalScript ? "warning" : "neutral",
            href: `/projects/${projectId}/storyboard`,
            ctaLabel: copy.enterStoryboard,
          },
          {
            label: copy.imagesStage,
            detail: copy.imagesDetail,
            summary: "根据分镜提示产出关键画面与参考图。",
            badgeLabel: copy.stageWaiting,
            tone: "neutral",
            href: `/projects/${projectId}/images`,
            ctaLabel: copy.enterImages,
          },
          {
            label: copy.videosStage,
            detail: copy.videosDetail,
            summary: "使用关键画面推进镜头运动与视频结果。",
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
            <h2 style={sectionTitleStyle}>{copy.startIdeaHeading}</h2>
            <p style={sectionDescriptionStyle}>{copy.startIdeaDescription}</p>
          </div>
          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>{copy.ideaLabel}</span>
            <textarea
              aria-label="Script idea input"
              value={idea}
              onChange={(event) => setIdea(event.target.value)}
              rows={6}
              style={textareaStyle}
              disabled={isSessionLocked}
            />
          </label>
          <div style={buttonRowStyle}>
            <button
              type="button"
              aria-label="Start script session"
              onClick={handleStartSession}
              style={primaryButtonStyle}
              disabled={isSessionLocked || !projectId}
            >
              {copy.startSession}
            </button>
            <button
              type="button"
              aria-label="Reset script session"
              onClick={handleResetSession}
              style={secondaryButtonStyle}
              disabled={isSessionLocked}
            >
              {copy.resetSession}
            </button>
          </div>
        </section>

        <section style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <h2 style={sectionTitleStyle}>{copy.questionsHeading}</h2>
            <p style={sectionDescriptionStyle}>{copy.questionsDescription}</p>
          </div>

          {questions.length === 0 && !streamingQuestion ? (
            <p style={emptyStateStyle}>{copy.questionEmpty}</p>
          ) : (
            <div style={stackStyle}>
              {questions.map((question, index) => (
                <article key={question.id} style={resultCardStyle}>
                  <p style={resultMetaStyle}>
                    {copy.roundPrefix}
                    {index + 1}
                    {copy.roundSuffix}
                  </p>
                  <strong style={resultTitleStyle}>{question.text}</strong>
                  {question.answer ? (
                    <p style={resultBodyStyle}>
                      {copy.answerPrefix}
                      {question.answer}
                    </p>
                  ) : null}
                </article>
              ))}
              {streamingQuestion ? (
                <article style={streamingCardStyle}>
                  <p style={resultMetaStyle}>{copy.streamingLabel}</p>
                  <strong style={resultTitleStyle}>{streamingQuestion}</strong>
                </article>
              ) : null}
            </div>
          )}

          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>{copy.answerLabel}</span>
            <textarea
              aria-label="Script answer input"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              rows={4}
              style={textareaStyle}
              disabled={isQuestionControlsLocked || !sessionId}
            />
          </label>
          <div style={buttonRowStyle}>
            <button
              type="button"
              aria-label="Send script answer"
              onClick={handleSendAnswer}
              style={primaryButtonStyle}
              disabled={isQuestionControlsLocked || !sessionId}
            >
              {copy.sendAnswer}
            </button>
            <button
              type="button"
              aria-label="Regenerate script question"
              onClick={handleRegenerateQuestion}
              style={secondaryButtonStyle}
              disabled={
                isQuestionControlsLocked || !sessionId || questions.length === 0
              }
            >
              {copy.regenerateQuestion}
            </button>
            <button
              type="button"
              aria-label="Finalize script"
              onClick={handleFinalize}
              style={primaryButtonStyle}
              disabled={
                isBusy ||
                isFinalizePolling ||
                isSessionCompleted ||
                !sessionId ||
                questions.length === 0
              }
            >
              {copy.finalize}
            </button>
          </div>
        </section>
      </div>

      <section style={panelStyle}>
        <div style={sectionHeaderStyle}>
          <h2 style={sectionTitleStyle}>{copy.finalScriptHeading}</h2>
          <p style={sectionDescriptionStyle}>{copy.finalScriptDescription}</p>
        </div>
        {finalScript ? (
          <pre style={outputPreStyle}>{finalScript}</pre>
        ) : (
          <p style={emptyStateStyle}>{copy.finalScriptEmpty}</p>
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

const buttonRowStyle = {
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

const stackStyle = {
  display: "grid",
  gap: "14px",
} satisfies CSSProperties;

const resultCardStyle = {
  display: "grid",
  gap: "8px",
  padding: "16px",
  borderRadius: "18px",
  border: "1px solid rgba(129, 140, 248, 0.16)",
  background: "rgba(8, 10, 26, 0.26)",
} satisfies CSSProperties;

const streamingCardStyle = {
  ...resultCardStyle,
  border: "1px dashed rgba(202, 138, 4, 0.35)",
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

const emptyStateStyle = {
  margin: 0,
  color: "var(--text-muted)",
  lineHeight: 1.7,
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
