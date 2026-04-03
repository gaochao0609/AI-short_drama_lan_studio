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
    <article style={panelStyle}>
      <h3 style={panelTitleStyle}>Create Project</h3>
      <p style={panelCopyStyle}>
        Start a new short-drama workspace from the browser, then continue into the script flow.
      </p>
      <form onSubmit={handleSubmit} style={formStyle}>
        <label style={fieldStyle}>
          <span>Project title</span>
          <input
            aria-label="Project title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            style={inputStyle}
            disabled={isSubmitting}
          />
        </label>
        <label style={fieldStyle}>
          <span>Project idea</span>
          <textarea
            aria-label="Project idea"
            value={idea}
            onChange={(event) => setIdea(event.target.value)}
            rows={4}
            style={textareaStyle}
            disabled={isSubmitting}
          />
        </label>
        {error ? (
          <p role="alert" style={errorStyle}>
            {error}
          </p>
        ) : null}
        <button type="submit" style={buttonStyle} disabled={isSubmitting}>
          {isSubmitting ? "Creating project..." : "Create project"}
        </button>
      </form>
    </article>
  );
}

const panelStyle = {
  padding: "24px",
  borderRadius: "24px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
  background: "rgba(255, 250, 243, 0.82)",
} satisfies CSSProperties;

const panelTitleStyle = {
  margin: 0,
  fontSize: "1.2rem",
} satisfies CSSProperties;

const panelCopyStyle = {
  margin: "12px 0 0",
  color: "#665d52",
  lineHeight: 1.6,
} satisfies CSSProperties;

const formStyle = {
  display: "grid",
  gap: "12px",
  marginTop: "18px",
} satisfies CSSProperties;

const fieldStyle = {
  display: "grid",
  gap: "8px",
  fontWeight: 600,
} satisfies CSSProperties;

const inputStyle = {
  width: "100%",
  borderRadius: "14px",
  border: "1px solid rgba(31, 27, 22, 0.16)",
  padding: "12px 14px",
  font: "inherit",
  background: "#fff",
  color: "#1f1b16",
} satisfies CSSProperties;

const textareaStyle = {
  ...inputStyle,
  resize: "vertical",
} satisfies CSSProperties;

const buttonStyle = {
  border: 0,
  borderRadius: "999px",
  background: "#8c5f2d",
  color: "#fff",
  padding: "12px 18px",
  font: "inherit",
  fontWeight: 700,
  cursor: "pointer",
} satisfies CSSProperties;

const errorStyle = {
  margin: 0,
  color: "#b42318",
} satisfies CSSProperties;
