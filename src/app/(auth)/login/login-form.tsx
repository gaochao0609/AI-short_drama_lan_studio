"use client";

import type { CSSProperties, FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

type LoginResponse = {
  userId: string;
  role: "ADMIN" | "USER";
  forcePasswordChange: boolean;
};

type LoginFormProps = {
  nextPath?: string;
};

function isLoginResponse(payload: LoginResponse | { error?: string }): payload is LoginResponse {
  return "role" in payload && "forcePasswordChange" in payload;
}

export default function LoginForm({ nextPath }: Readonly<LoginFormProps>) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          username,
          password,
        }),
      });
      const payload = (await response.json()) as LoginResponse | { error?: string };

      if (!response.ok) {
        setError("error" in payload ? payload.error ?? "登录失败" : "登录失败");
        return;
      }

      if (!isLoginResponse(payload)) {
        setError("登录失败");
        return;
      }

      if (payload.forcePasswordChange) {
        router.push("/force-password");
        return;
      }

      if (payload.role === "ADMIN") {
        router.push(nextPath || "/admin/users");
        return;
      }

      router.push("/workspace");
    } catch {
      setError("登录失败，请稍后再试。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main style={shellStyle}>
      <section style={panelStyle}>
        <p style={eyebrowStyle}>Lan Studio</p>
        <h1 style={titleStyle}>账号登录</h1>
        <p style={copyStyle}>使用工作账号登录，进入创作工作区继续推进短剧生产。</p>
        <form onSubmit={handleSubmit} style={formStyle}>
          <label style={fieldStyle}>
            <span>用户名</span>
            <input
              aria-label="用户名"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              style={inputStyle}
            />
          </label>
          <label style={fieldStyle}>
            <span>密码</span>
            <input
              aria-label="密码"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              style={inputStyle}
            />
          </label>
          {error ? (
            <p role="alert" aria-live="assertive" style={errorStyle}>
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={isSubmitting} style={buttonStyle}>
            {isSubmitting ? "正在进入..." : "进入创作工作区"}
          </button>
        </form>
        <p style={footerStyle}>
          还没有账号？<a href="/register-request">提交注册申请</a>
        </p>
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
  background: "linear-gradient(135deg, #ca8a04, #6d5efc)",
  color: "#0f172a",
  padding: "12px 18px",
  font: "inherit",
  fontWeight: 700,
  cursor: "pointer",
} satisfies CSSProperties;

const errorStyle = {
  margin: 0,
  color: "#f87171",
} satisfies CSSProperties;

const footerStyle = {
  margin: "18px 0 0",
  color: "#b8c0d4",
} satisfies CSSProperties;
