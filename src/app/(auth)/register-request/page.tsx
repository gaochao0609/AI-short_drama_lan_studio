"use client";

import type { CSSProperties, FormEvent } from "react";
import { useState } from "react";

export default function RegisterRequestPage() {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/register-request", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          username,
          displayName,
          reason,
        }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "提交失败");
        return;
      }

      setSubmitted(true);
    } catch {
      setError("提交失败，请稍后再试。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main style={shellStyle}>
      <section style={panelStyle}>
        <p style={eyebrowStyle}>Lan Studio</p>
        <h1 style={titleStyle}>注册申请</h1>
        <p style={copyStyle}>提交注册申请后，审批通过即可进入创作工作区。</p>
        {submitted ? (
          <div style={successPanelStyle}>
            <p role="status" aria-live="polite" style={successTitleStyle}>
              申请已提交，请等待管理员审批。
            </p>
            <p style={copyStyle}>审批完成后，请返回登录页使用管理员下发的初始密码登录。</p>
            <a href="/login">返回登录</a>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={formStyle}>
            <label style={fieldStyle}>
              <span>用户名</span>
              <input
                aria-label="用户名"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span>显示名称</span>
              <input
                aria-label="显示名称"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span>申请说明</span>
              <textarea
                aria-label="申请说明"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={4}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </label>
            {error ? (
              <p role="alert" aria-live="assertive" style={errorStyle}>
                {error}
              </p>
            ) : null}
            <button type="submit" disabled={isSubmitting} style={buttonStyle}>
              {isSubmitting ? "正在提交..." : "提交注册申请"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

const shellStyle = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: "24px",
} satisfies CSSProperties;

const panelStyle = {
  width: "min(560px, 100%)",
  borderRadius: "24px",
  border: "1px solid rgba(129, 140, 248, 0.24)",
  background: "rgba(22, 24, 39, 0.9)",
  boxShadow: "0 24px 60px rgba(3, 7, 18, 0.48)",
  padding: "32px",
} satisfies CSSProperties;

const eyebrowStyle = {
  margin: 0,
  color: "#ca8a04",
  textTransform: "uppercase",
  letterSpacing: "0.16em",
  fontSize: "0.8rem",
} satisfies CSSProperties;

const titleStyle = {
  margin: "12px 0 0",
  fontSize: "2rem",
  lineHeight: 1.1,
} satisfies CSSProperties;

const copyStyle = {
  margin: "12px 0 0",
  color: "#b8c0d4",
  lineHeight: 1.65,
} satisfies CSSProperties;

const formStyle = {
  display: "grid",
  gap: "14px",
  marginTop: "24px",
} satisfies CSSProperties;

const fieldStyle = {
  display: "grid",
  gap: "8px",
  fontWeight: 600,
} satisfies CSSProperties;

const inputStyle = {
  width: "100%",
  borderRadius: "14px",
  border: "1px solid rgba(129, 140, 248, 0.24)",
  padding: "12px 14px",
  font: "inherit",
  background: "rgba(15, 15, 35, 0.72)",
  color: "#f8fafc",
} satisfies CSSProperties;

const buttonStyle = {
  border: 0,
  borderRadius: "999px",
  background: "linear-gradient(135deg, #7a3b00, #4338ca)",
  color: "#f8fafc",
  padding: "12px 18px",
  font: "inherit",
  fontWeight: 700,
  cursor: "pointer",
} satisfies CSSProperties;

const errorStyle = {
  margin: 0,
  color: "#f87171",
} satisfies CSSProperties;

const successPanelStyle = {
  marginTop: "24px",
  padding: "18px",
  borderRadius: "18px",
  border: "1px solid rgba(129, 140, 248, 0.24)",
  background: "rgba(15, 15, 35, 0.72)",
} satisfies CSSProperties;

const successTitleStyle = {
  margin: 0,
  fontWeight: 700,
} satisfies CSSProperties;
