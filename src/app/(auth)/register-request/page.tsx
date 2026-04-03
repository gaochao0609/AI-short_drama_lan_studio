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
      <section style={cardStyle}>
        <p style={eyebrowStyle}>Lan Studio</p>
        <h1 style={titleStyle}>注册申请</h1>
        <p style={copyStyle}>提交申请后，页面会保留待审批状态提示，管理员审批通过后才能登录。</p>
        {submitted ? (
          <div style={successPanelStyle}>
            <p style={successTitleStyle}>申请已提交，等待管理员审批。</p>
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
            {error ? <p style={errorStyle}>{error}</p> : null}
            <button type="submit" disabled={isSubmitting} style={buttonStyle}>
              {isSubmitting ? "提交中..." : "提交申请"}
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

const cardStyle = {
  width: "min(560px, 100%)",
  borderRadius: "24px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
  background: "rgba(255, 250, 243, 0.94)",
  boxShadow: "0 24px 60px rgba(31, 27, 22, 0.12)",
  padding: "32px",
} satisfies CSSProperties;

const eyebrowStyle = {
  margin: 0,
  color: "#8c5f2d",
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  fontSize: "0.8rem",
} satisfies CSSProperties;

const titleStyle = {
  margin: "12px 0 0",
  fontSize: "2rem",
} satisfies CSSProperties;

const copyStyle = {
  margin: "12px 0 0",
  color: "#665d52",
  lineHeight: 1.6,
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
  border: "1px solid rgba(31, 27, 22, 0.16)",
  padding: "12px 14px",
  font: "inherit",
  background: "#fff",
  color: "#1f1b16",
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

const successPanelStyle = {
  marginTop: "24px",
  padding: "18px",
  borderRadius: "18px",
  background: "rgba(140, 95, 45, 0.08)",
} satisfies React.CSSProperties;

const successTitleStyle = {
  margin: 0,
  fontWeight: 700,
} satisfies React.CSSProperties;
