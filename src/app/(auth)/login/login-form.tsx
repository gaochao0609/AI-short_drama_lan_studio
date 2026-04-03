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
      <section style={cardStyle}>
        <p style={eyebrowStyle}>Lan Studio</p>
        <h1 style={titleStyle}>账号登录</h1>
        <p style={copyStyle}>管理员审批通过后，使用账号和密码进入工作区。</p>
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
          {error ? <p style={errorStyle}>{error}</p> : null}
          <button type="submit" disabled={isSubmitting} style={buttonStyle}>
            {isSubmitting ? "登录中..." : "登录"}
          </button>
        </form>
        <p style={footerStyle}>
          没有账号？<a href="/register-request">提交注册申请</a>
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

const cardStyle = {
  width: "min(460px, 100%)",
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
} satisfies React.CSSProperties;

const footerStyle = {
  margin: "18px 0 0",
  color: "#665d52",
} satisfies React.CSSProperties;
