"use client";

import type { CSSProperties, FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

const copy = {
  title: "\u521b\u5efa\u9879\u76ee\u5e76\u8fdb\u5165\u811a\u672c\u6d41\u7a0b",
  description:
    "\u4ece\u8fd9\u91cc\u5efa\u7acb\u65b0\u7684\u77ed\u5267\u9879\u76ee\u3002\u6807\u9898\u4e0e\u6982\u5ff5\u4f1a\u6309\u539f\u6837\u63d0\u4ea4\u5230\u9879\u76ee\u63a5\u53e3\uff0c\u521b\u5efa\u6210\u529f\u540e\u4ecd\u7136\u76f4\u63a5\u8fdb\u5165\u9879\u76ee\u8be6\u60c5\u9875\u3002",
  name: "\u9879\u76ee\u540d\u79f0",
  idea: "\u9879\u76ee\u6982\u5ff5",
  namePlaceholder: "\u4f8b\u5982\uff1a\u8bb0\u5fc6\u9ed1\u7bb1",
  ideaPlaceholder:
    "\u4e00\u53e5\u8bdd\u8bf4\u660e\u6545\u4e8b\u51b2\u7a81\u3001\u4e3b\u89d2\u5904\u5883\u6216\u89c6\u89c9\u65b9\u5411\u3002",
  creating: "\u6b63\u5728\u521b\u5efa\u9879\u76ee...",
} as const;

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
      <h2 style={panelTitleStyle}>{copy.title}</h2>
      <p style={panelCopyStyle}>{copy.description}</p>
      <form onSubmit={handleSubmit} style={formStyle}>
        <label style={fieldStyle}>
          <span>{copy.name}</span>
          <input
            aria-label={copy.name}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            style={inputStyle}
            disabled={isSubmitting}
            placeholder={copy.namePlaceholder}
          />
        </label>
        <label style={fieldStyle}>
          <span>{copy.idea}</span>
          <textarea
            aria-label={copy.idea}
            value={idea}
            onChange={(event) => setIdea(event.target.value)}
            rows={4}
            style={textareaStyle}
            disabled={isSubmitting}
            placeholder={copy.ideaPlaceholder}
          />
        </label>
        {error ? (
          <p role="alert" style={errorStyle}>
            {error}
          </p>
        ) : null}
        <button type="submit" style={buttonStyle} disabled={isSubmitting}>
          {isSubmitting ? copy.creating : copy.title}
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
