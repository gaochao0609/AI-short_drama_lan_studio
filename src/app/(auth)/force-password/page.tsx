"use client";

import type { CSSProperties, FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ForcePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!password) {
      setError("请输入新密码。");
      return;
    }

    if (password !== confirmPassword) {
      setError("两次输入的密码不一致。");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/force-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          password,
        }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "修改失败");
        return;
      }

      router.push("/");
    } catch {
      setError("修改失败，请稍后再试。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main style={shellStyle}>
      <section style={panelStyle}>
        <p style={eyebrowStyle}>Lan Studio</p>
        <h1 style={titleStyle}>首次登录重设密码</h1>
        <p style={copyStyle}>首次登录需要重设密码，完成后即可进入创作工作区。</p>
        <form onSubmit={handleSubmit} style={formStyle}>
          <label style={fieldStyle}>
            <span>新密码</span>
            <input
              aria-label="新密码"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              style={inputStyle}
            />
          </label>
          <label style={fieldStyle}>
            <span>确认新密码</span>
            <input
              aria-label="确认新密码"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              style={inputStyle}
            />
          </label>
          {error ? (
            <p role="alert" aria-live="assertive" style={errorStyle}>
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={isSubmitting} style={buttonStyle}>
            {isSubmitting ? "正在保存..." : "保存并进入工作区"}
          </button>
        </form>
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
  width: "min(460px, 100%)",
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
  background:
    "linear-gradient(135deg, rgba(15, 23, 42, 0.28), rgba(15, 23, 42, 0.28)), linear-gradient(135deg, #ca8a04, #6d5efc)",
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
