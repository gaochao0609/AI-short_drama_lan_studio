"use client";

import type { CSSProperties, FormEvent } from "react";
import { useEffect, useState } from "react";
import StatusBadge from "@/components/studio/status-badge";

type AccountRequestItem = {
  id: string;
  username: string;
  displayName: string;
  reason: string | null;
  status: string;
  createdAt: string;
};

type UserItem = {
  id: string;
  username: string;
  role: "ADMIN" | "USER";
  status: "PENDING" | "ACTIVE" | "DISABLED";
  forcePasswordChange: boolean;
  createdAt: string;
};

function toUserStatusLabel(status: UserItem["status"]) {
  if (status === "ACTIVE") {
    return "已启用";
  }

  if (status === "DISABLED") {
    return "已禁用";
  }

  return "待激活";
}

function toUserStatusTone(status: UserItem["status"]) {
  if (status === "ACTIVE") {
    return "success";
  }

  if (status === "DISABLED") {
    return "danger";
  }

  return "warning";
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [requests, setRequests] = useState<AccountRequestItem[]>([]);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<"ADMIN" | "USER">("USER");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchAdminData() {
    const [usersResponse, requestsResponse] = await Promise.all([
      fetch("/api/admin/users", { cache: "no-store" }),
      fetch("/api/admin/account-requests", { cache: "no-store" }),
    ]);

    if (!usersResponse.ok || !requestsResponse.ok) {
      const payload = (await usersResponse.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? "加载失败");
    }

    const usersPayload = (await usersResponse.json()) as { users: UserItem[] };
    const requestsPayload = (await requestsResponse.json()) as { requests: AccountRequestItem[] };

    return {
      users: usersPayload.users,
      requests: requestsPayload.requests.filter((request) => request.status === "PENDING"),
    };
  }

  async function loadData() {
    const data = await fetchAdminData();
    setUsers(data.users);
    setRequests(data.requests);
  }

  useEffect(() => {
    let isActive = true;

    async function runInitialLoad() {
      try {
        const data = await fetchAdminData();

        if (!isActive) {
          return;
        }

        setUsers(data.users);
        setRequests(data.requests);
      } catch (loadError) {
        if (!isActive) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "加载失败");
      }
    }

    void runInitialLoad();

    return () => {
      isActive = false;
    };
  }, []);

  async function createManagedUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ username, role }),
    });
    const payload = (await response.json()) as { error?: string; tempPassword?: string };

    if (!response.ok) {
      setError(payload.error ?? "创建失败");
      return;
    }

    setUsername("");
    setRole("USER");
    setMessage(`账号已创建，初始密码：${payload.tempPassword}`);
    await loadData();
  }

  async function approveRequest(requestId: string) {
    setError(null);
    setMessage(null);

    const response = await fetch("/api/admin/account-requests", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ requestId }),
    });
    const payload = (await response.json()) as { error?: string; tempPassword?: string };

    if (!response.ok) {
      setError(payload.error ?? "审批失败");
      return;
    }

    setMessage(`申请已通过，初始密码：${payload.tempPassword}`);
    await loadData();
  }

  async function disableManagedUser(userId: string) {
    setError(null);
    setMessage(null);

    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ userId, status: "DISABLED" }),
    });
    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(payload.error ?? "禁用失败");
      return;
    }

    setMessage("账号已禁用，当前登录会话会在下次鉴权时失效。");
    await loadData();
  }

  async function resetManagedPassword(userId: string) {
    setError(null);
    setMessage(null);

    const response = await fetch(`/api/admin/users/${userId}/reset-password`, {
      method: "POST",
    });
    const payload = (await response.json()) as { error?: string; tempPassword?: string };

    if (!response.ok) {
      setError(payload.error ?? "重置失败");
      return;
    }

    setMessage(`密码已重置，临时密码：${payload.tempPassword}`);
    await loadData();
  }

  return (
    <section style={pageStyle}>
      <header style={headerStyle}>
        <p style={eyebrowStyle}>用户与权限</p>
        <h2 style={titleStyle}>账号审批与权限管理</h2>
        <p style={copyStyle}>处理注册申请、创建内部账号、禁用账号和重置密码。</p>
      </header>

      {message ? <p style={messageStyle}>{message}</p> : null}
      {error ? <p style={errorStyle}>{error}</p> : null}

      <div style={gridStyle}>
        <section style={panelStyle}>
          <h3 style={panelTitleStyle}>创建账号</h3>
          <form onSubmit={createManagedUser} style={formStyle}>
            <label style={fieldStyle}>
              <span>用户名</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span>角色</span>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as "ADMIN" | "USER")}
                style={inputStyle}
              >
                <option value="USER">USER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </label>
            <button type="submit" style={primaryButtonStyle}>
              创建账号
            </button>
          </form>
        </section>

        <section style={panelStyle}>
          <h3 style={panelTitleStyle}>待审批申请</h3>
          <div style={listStyle}>
            {requests.length === 0 ? <p style={copyStyle}>当前没有待处理申请。</p> : null}
            {requests.map((request) => (
              <article key={request.id} style={itemStyle}>
                <div style={itemContentStyle}>
                  <strong>{request.displayName}</strong>
                  <p style={metaStyle}>{request.username}</p>
                  <p style={metaStyle}>{request.reason || "未填写申请说明。"}</p>
                </div>
                <button type="button" onClick={() => void approveRequest(request.id)} style={primaryButtonStyle}>
                  通过申请
                </button>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section style={panelStyle}>
        <h3 style={panelTitleStyle}>已有账号</h3>
        <div style={listStyle}>
          {users.map((user) => (
            <article key={user.id} style={itemStyle}>
              <div style={itemContentStyle}>
                <div style={itemTitleRowStyle}>
                  <strong>{user.username}</strong>
                  <StatusBadge label={toUserStatusLabel(user.status)} tone={toUserStatusTone(user.status)} />
                  {user.forcePasswordChange ? <StatusBadge label="需改密" tone="warning" /> : null}
                </div>
                <p style={metaStyle}>角色：{user.role}</p>
              </div>
              <div style={actionsStyle}>
                <button type="button" onClick={() => void resetManagedPassword(user.id)} style={secondaryButtonStyle}>
                  重置密码
                </button>
                {user.status !== "DISABLED" ? (
                  <button type="button" onClick={() => void disableManagedUser(user.id)} style={dangerButtonStyle}>
                    禁用账号
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

const pageStyle = {
  display: "grid",
  gap: "20px",
} satisfies CSSProperties;

const headerStyle = {
  display: "grid",
  gap: "8px",
} satisfies CSSProperties;

const eyebrowStyle = {
  margin: 0,
  color: "var(--accent-gold)",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  fontSize: "0.78rem",
} satisfies CSSProperties;

const titleStyle = {
  margin: 0,
  fontSize: "1.85rem",
  lineHeight: 1.2,
} satisfies CSSProperties;

const copyStyle = {
  margin: 0,
  color: "var(--text-muted)",
  lineHeight: 1.6,
} satisfies CSSProperties;

const gridStyle = {
  display: "grid",
  gap: "16px",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
} satisfies CSSProperties;

const panelStyle = {
  borderRadius: "20px",
  border: "1px solid var(--border)",
  background: "rgba(22, 24, 39, 0.82)",
  padding: "18px",
} satisfies CSSProperties;

const panelTitleStyle = {
  margin: 0,
  fontSize: "1.06rem",
} satisfies CSSProperties;

const formStyle = {
  display: "grid",
  gap: "12px",
  marginTop: "14px",
} satisfies CSSProperties;

const fieldStyle = {
  display: "grid",
  gap: "8px",
  fontWeight: 600,
} satisfies CSSProperties;

const inputStyle = {
  width: "100%",
  borderRadius: "12px",
  border: "1px solid var(--border)",
  padding: "10px 12px",
  font: "inherit",
  background: "rgba(15, 15, 35, 0.72)",
  color: "var(--text)",
} satisfies CSSProperties;

const listStyle = {
  display: "grid",
  gap: "10px",
  marginTop: "14px",
} satisfies CSSProperties;

const itemStyle = {
  display: "grid",
  gap: "10px",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  padding: "12px",
  borderRadius: "14px",
  border: "1px solid var(--border)",
  background: "rgba(15, 15, 35, 0.56)",
} satisfies CSSProperties;

const itemContentStyle = {
  display: "grid",
  gap: "6px",
} satisfies CSSProperties;

const itemTitleRowStyle = {
  display: "flex",
  gap: "8px",
  alignItems: "center",
  flexWrap: "wrap",
} satisfies CSSProperties;

const metaStyle = {
  margin: 0,
  color: "var(--text-muted)",
  fontSize: "0.92rem",
} satisfies CSSProperties;

const actionsStyle = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  justifyContent: "flex-end",
} satisfies CSSProperties;

const baseButtonStyle = {
  border: "1px solid transparent",
  borderRadius: "999px",
  padding: "8px 12px",
  font: "inherit",
  fontWeight: 700,
  cursor: "pointer",
} satisfies CSSProperties;

const primaryButtonStyle = {
  ...baseButtonStyle,
  background: "var(--accent-violet)",
  color: "var(--text)",
} satisfies CSSProperties;

const secondaryButtonStyle = {
  ...baseButtonStyle,
  background: "rgba(248, 250, 252, 0.08)",
  borderColor: "var(--border)",
  color: "var(--text)",
} satisfies CSSProperties;

const dangerButtonStyle = {
  ...baseButtonStyle,
  background: "rgba(248, 113, 113, 0.18)",
  borderColor: "var(--border)",
  color: "var(--text)",
} satisfies CSSProperties;

const messageStyle = {
  margin: 0,
  padding: "12px 14px",
  borderRadius: "14px",
  border: "1px solid var(--border)",
  background: "rgba(109, 94, 252, 0.2)",
  color: "var(--text)",
} satisfies CSSProperties;

const errorStyle = {
  margin: 0,
  padding: "12px 14px",
  borderRadius: "14px",
  border: "1px solid var(--border)",
  background: "rgba(248, 113, 113, 0.2)",
  color: "var(--text)",
} satisfies CSSProperties;
