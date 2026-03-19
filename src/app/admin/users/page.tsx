"use client";

import type { CSSProperties, FormEvent } from "react";
import { useEffect, useState } from "react";

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

    setMessage(`申请已审批，初始密码：${payload.tempPassword}`);
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

    setMessage("账号已禁用，现有会话已失效。");
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
      <header>
        <p style={eyebrowStyle}>Users</p>
        <h2 style={titleStyle}>账号与审批</h2>
        <p style={copyStyle}>在这里处理注册申请、创建账号、禁用账号和重置密码。</p>
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
            <button type="submit" style={buttonStyle}>
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
                <div>
                  <strong>{request.displayName}</strong>
                  <p style={metaStyle}>
                    {request.username} · {request.status}
                  </p>
                  <p style={metaStyle}>{request.reason || "未填写申请说明"}</p>
                </div>
                <button type="button" onClick={() => approveRequest(request.id)} style={buttonStyle}>
                  审批
                </button>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section style={panelStyle}>
        <h3 style={panelTitleStyle}>现有账号</h3>
        <div style={listStyle}>
          {users.map((user) => (
            <article key={user.id} style={itemStyle}>
              <div>
                <strong>{user.username}</strong>
                <p style={metaStyle}>
                  {user.role} · {user.status} ·{" "}
                  {user.forcePasswordChange ? "需改密" : "正常"}
                </p>
              </div>
              <div style={actionsStyle}>
                <button type="button" onClick={() => resetManagedPassword(user.id)} style={buttonStyle}>
                  重置密码
                </button>
                {user.status !== "DISABLED" ? (
                  <button type="button" onClick={() => disableManagedUser(user.id)} style={dangerButtonStyle}>
                    禁用
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

const eyebrowStyle = {
  margin: 0,
  color: "#8c5f2d",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  fontSize: "0.8rem",
} satisfies CSSProperties;

const titleStyle = {
  margin: "10px 0 0",
  fontSize: "2rem",
} satisfies CSSProperties;

const copyStyle = {
  margin: "10px 0 0",
  color: "#665d52",
  lineHeight: 1.6,
} satisfies CSSProperties;

const gridStyle = {
  display: "grid",
  gap: "20px",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
} satisfies CSSProperties;

const panelStyle = {
  borderRadius: "24px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
  background: "rgba(255, 250, 243, 0.94)",
  padding: "20px",
} satisfies CSSProperties;

const panelTitleStyle = {
  margin: 0,
  fontSize: "1.2rem",
} satisfies CSSProperties;

const formStyle = {
  display: "grid",
  gap: "12px",
  marginTop: "16px",
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
} satisfies CSSProperties;

const listStyle = {
  display: "grid",
  gap: "12px",
  marginTop: "16px",
} satisfies CSSProperties;

const itemStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "center",
  padding: "14px",
  borderRadius: "18px",
  background: "rgba(140, 95, 45, 0.06)",
} satisfies CSSProperties;

const metaStyle = {
  margin: "6px 0 0",
  color: "#665d52",
} satisfies CSSProperties;

const actionsStyle = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  justifyContent: "flex-end",
} satisfies CSSProperties;

const buttonStyle = {
  border: 0,
  borderRadius: "999px",
  background: "#8c5f2d",
  color: "#fff",
  padding: "10px 14px",
  font: "inherit",
  fontWeight: 700,
  cursor: "pointer",
} satisfies CSSProperties;

const dangerButtonStyle = {
  ...buttonStyle,
  background: "#b42318",
} satisfies React.CSSProperties;

const messageStyle = {
  margin: 0,
  padding: "14px 16px",
  borderRadius: "16px",
  background: "rgba(23, 92, 49, 0.12)",
  color: "#175c31",
} satisfies React.CSSProperties;

const errorStyle = {
  margin: 0,
  padding: "14px 16px",
  borderRadius: "16px",
  background: "rgba(180, 35, 24, 0.12)",
  color: "#b42318",
} satisfies React.CSSProperties;
