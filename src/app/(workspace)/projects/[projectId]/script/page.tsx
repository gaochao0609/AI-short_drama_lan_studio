"use client";

import type { CSSProperties } from "react";
import { startTransition, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
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
  const [projectTitle, setProjectTitle] = useState("Script Workspace");
  const [idea, setIdea] = useState("");
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
              ? payload.error ?? "Failed to load project"
              : "Failed to load project",
          );
        }

        if (!cancelled && payload && "title" in payload) {
          setProjectTitle(payload.title);
          setIdea((current) => current || payload.idea || "");
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

    setStatusMessage(null);
    setError(
      pollingError instanceof Error
        ? pollingError.message
        : "Failed to fetch task",
    );
    setActiveTaskId(null);
  }, [activeTaskId, pollingError]);

  useEffect(() => {
    const polledTask = task as TaskPollResponse | undefined;

    if (!activeTaskId || !polledTask) {
      return;
    }

    if (polledTask.status === "RUNNING") {
      setStatusMessage("正在生成最终剧本...");
      setError(null);
      return;
    }

    if (polledTask.status === "SUCCEEDED") {
      setStatusMessage("最终剧本已生成。");
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
      setError(polledTask.errorText ?? "剧本定稿任务失败");
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
      throw new Error(payload?.error ?? "Script session request failed");
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
            throw new Error(payload.message ?? "Script stream failed");
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
      setError("请输入创意后再开始会话");
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
        submitError instanceof Error
          ? submitError.message
          : "启动剧本会话失败",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSendAnswer() {
    if (!sessionId || !answer.trim()) {
      setError("请输入回答后再继续");
      return;
    }

    setError(null);
    setStatusMessage(null);
    setIsSubmitting(true);
    const submittedAnswer = answer;

    try {
      const response = await fetch(
        `/api/script/sessions/${sessionId}/message`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            answer: submittedAnswer,
          }),
        },
      );

      await consumeQuestionStream(response, "next", submittedAnswer);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "提交回答失败",
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
      const response = await fetch(
        `/api/script/sessions/${sessionId}/regenerate`,
        {
          method: "POST",
        },
      );

      await consumeQuestionStream(response, "regenerate");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "重新生成问题失败",
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
    setStatusMessage("正在生成最终剧本...");
    setIsSubmitting(true);

    try {
      const response = await fetch(
        `/api/script/sessions/${sessionId}/finalize`,
        {
          method: "POST",
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { taskId?: string; error?: string }
        | null;

      if (!response.ok || !payload?.taskId) {
        throw new Error(payload?.error ?? "剧本定稿失败");
      }

      setActiveTaskId(payload.taskId);
    } catch (submitError) {
      setStatusMessage(null);
      setError(
        submitError instanceof Error
          ? submitError.message
          : "剧本定稿失败",
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

  return (
    <section style={pageStyle}>
      <header style={heroStyle}>
        <div>
          <p style={eyebrowStyle}>Script Workflow</p>
          <h2 style={heroTitleStyle}>
            {isLoadingProject ? "Loading project..." : projectTitle}
          </h2>
          <p style={heroCopyStyle}>
            用会话式提问逐步澄清短剧设定，完成后把剧本定稿任务交给后端队列。
          </p>
        </div>
        <div style={heroActionsStyle}>
          <Link href="/workspace" style={secondaryLinkStyle}>
            返回工作区
          </Link>
          <Link href={`/projects/${projectId}`} style={secondaryLinkStyle}>
            返回项目详情
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
          <h3 style={panelTitleStyle}>创意输入</h3>
          <p style={panelCopyStyle}>
            先给出一个足够模糊但方向明确的短剧想法，系统会继续追问关键设定。
          </p>
          <label style={fieldStyle}>
            <span>创意</span>
            <textarea
              aria-label="Script idea input"
              value={idea}
              onChange={(event) => setIdea(event.target.value)}
              rows={5}
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
              开始会话
            </button>
            <button
              type="button"
              aria-label="Reset script session"
              onClick={handleResetSession}
              style={secondaryButtonStyle}
              disabled={isSessionLocked}
            >
              开始新会话
            </button>
          </div>
        </section>

        <section style={panelStyle}>
          <h3 style={panelTitleStyle}>问题列表</h3>
          <p style={panelCopyStyle}>
            当前轮的问题会以流式方式逐步出现，重新生成只会替换最后一个问题。
          </p>

          {questions.length === 0 && !streamingQuestion ? (
            <p style={emptyStyle}>会话开始后，AI 问题会显示在这里。</p>
          ) : (
            <div style={questionListStyle}>
              {questions.map((question, index) => (
                <article key={question.id} style={questionCardStyle}>
                  <p style={questionIndexStyle}>Round {index + 1}</p>
                  <strong>{question.text}</strong>
                  {question.answer ? (
                    <p style={answerPreviewStyle}>回答：{question.answer}</p>
                  ) : null}
                </article>
              ))}
              {streamingQuestion ? (
                <article style={streamingCardStyle}>
                  <p style={questionIndexStyle}>Streaming</p>
                  <strong>{streamingQuestion}</strong>
                </article>
              ) : null}
            </div>
          )}

          <label style={fieldStyle}>
            <span>回答</span>
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
              发送回答
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
              重新生成当前问题
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
              剧本定稿
            </button>
          </div>
        </section>
      </div>

      <section style={panelStyle}>
        <h3 style={panelTitleStyle}>最终剧本</h3>
        <p style={panelCopyStyle}>
          定稿后页面会自动短轮询后台任务，成功后在这里展示最终剧本文本。
        </p>
        {finalScript ? (
          <pre style={scriptOutputStyle}>{finalScript}</pre>
        ) : (
          <p style={emptyStyle}>尚未生成最终剧本。</p>
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

const textareaStyle = {
  width: "100%",
  borderRadius: "16px",
  border: "1px solid rgba(31, 27, 22, 0.16)",
  padding: "14px 16px",
  font: "inherit",
  background: "#fff",
  resize: "vertical",
} satisfies CSSProperties;

const buttonRowStyle = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
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

const secondaryButtonStyle = {
  ...primaryButtonStyle,
  background: "rgba(140, 95, 45, 0.12)",
  color: "#4b3a27",
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

const questionListStyle = {
  display: "grid",
  gap: "12px",
} satisfies CSSProperties;

const questionCardStyle = {
  padding: "16px",
  borderRadius: "18px",
  background: "rgba(140, 95, 45, 0.08)",
  display: "grid",
  gap: "8px",
} satisfies CSSProperties;

const streamingCardStyle = {
  ...questionCardStyle,
  border: "1px dashed rgba(140, 95, 45, 0.35)",
} satisfies CSSProperties;

const questionIndexStyle = {
  margin: 0,
  color: "#8c5f2d",
  fontSize: "0.85rem",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
} satisfies CSSProperties;

const answerPreviewStyle = {
  margin: 0,
  color: "#665d52",
  lineHeight: 1.5,
} satisfies CSSProperties;

const scriptOutputStyle = {
  margin: 0,
  padding: "18px",
  borderRadius: "18px",
  background: "#fff",
  border: "1px solid rgba(31, 27, 22, 0.12)",
  whiteSpace: "pre-wrap",
  lineHeight: 1.7,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
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
