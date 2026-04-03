"use client";

import type { CSSProperties, FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

type CreateProjectResponse = {
  id: string;
  title: string;
  idea?: string | null;
};

function isCreateProjectResponse(
  payload: CreateProjectResponse | { error?: string } | null,
): payload is CreateProjectResponse {
  return Boolean(payload && typeof payload === "object" && "id" in payload);
}

export default function CreateProjectForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [idea, setIdea] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!title.trim()) {
      setError("Project title is required");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: title.trim(),
          idea: idea.trim(),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | CreateProjectResponse
        | { error?: string }
        | null;

      if (!response.ok || !isCreateProjectResponse(payload)) {
        setError(
          payload && "error" in payload
            ? payload.error ?? "Failed to create project"
            : "Failed to create project",
        );
        return;
      }

      router.push(`/projects/${payload.id}`);
    } catch {
      setError("Failed to create project");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <article id="create-project-entry" style={panelStyle}>
      <p style={panelEyebrowStyle}>Create Project</p>
      <h2 style={panelTitleStyle}>创建项目并进入脚本流程</h2>
      <p style={panelCopyStyle}>
        从这里建立新的短剧项目。标题与概念会按原样提交到项目接口，创建成功后仍然直接进入项目详情页。
      </p>
      <form onSubmit={handleSubmit} style={formStyle}>
        <label style={fieldStyle}>
          <span>项目名称</span>
          <input
            aria-label="项目名称"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            style={inputStyle}
            disabled={isSubmitting}
            placeholder="例如：记忆黑箱"
          />
        </label>
        <label style={fieldStyle}>
          <span>项目概念</span>
          <textarea
            aria-label="项目概念"
            value={idea}
            onChange={(event) => setIdea(event.target.value)}
            rows={4}
            style={textareaStyle}
            disabled={isSubmitting}
            placeholder="一句话说明故事冲突、主角处境或视觉方向。"
          />
        </label>
        {error ? (
          <p role="alert" style={errorStyle}>
            {error}
          </p>
        ) : null}
        <button type="submit" style={buttonStyle} disabled={isSubmitting}>
          {isSubmitting ? "正在创建项目..." : "创建项目并进入脚本流程"}
        </button>
      </form>
    </article>
  );
}

const panelStyle = {
  display: "grid",
  gap: "12px",
  padding: "28px",
  borderRadius: "28px",
  border: "1px solid rgba(109, 94, 252, 0.26)",
  background:
    "linear-gradient(180deg, rgba(109, 94, 252, 0.18), rgba(22, 24, 39, 0.94) 44%, rgba(22, 24, 39, 0.98))",
  boxShadow: "0 28px 60px rgba(10, 12, 24, 0.32)",
} satisfies CSSProperties;

const panelEyebrowStyle = {
  margin: 0,
  color: "#ca8a04",
  textTransform: "uppercase",
  letterSpacing: "0.16em",
  fontSize: "0.74rem",
} satisfies CSSProperties;

const panelTitleStyle = {
  margin: 0,
  fontSize: "clamp(1.6rem, 2.3vw, 2.2rem)",
  lineHeight: 1.08,
} satisfies CSSProperties;

const panelCopyStyle = {
  margin: 0,
  color: "#b8c0d4",
  lineHeight: 1.6,
} satisfies CSSProperties;

const formStyle = {
  display: "grid",
  gap: "14px",
  marginTop: "8px",
} satisfies CSSProperties;

const fieldStyle = {
  display: "grid",
  gap: "8px",
  fontWeight: 600,
  color: "#f8fafc",
} satisfies CSSProperties;

const inputStyle = {
  width: "100%",
  borderRadius: "14px",
  border: "1px solid rgba(129, 140, 248, 0.28)",
  padding: "14px 16px",
  font: "inherit",
  background: "rgba(9, 11, 24, 0.52)",
  color: "#f8fafc",
} satisfies CSSProperties;

const textareaStyle = {
  ...inputStyle,
  resize: "vertical",
  minHeight: "132px",
} satisfies CSSProperties;

const buttonStyle = {
  border: 0,
  borderRadius: "999px",
  background: "linear-gradient(135deg, #ca8a04, #f59e0b)",
  color: "#0f0f23",
  padding: "14px 18px",
  font: "inherit",
  fontWeight: 700,
  cursor: "pointer",
  justifySelf: "start",
  boxShadow: "0 18px 32px rgba(202, 138, 4, 0.24)",
} satisfies CSSProperties;

const errorStyle = {
  margin: 0,
  color: "#fca5a5",
} satisfies CSSProperties;
