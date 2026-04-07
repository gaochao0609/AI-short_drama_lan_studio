"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import StatusBadge from "@/components/studio/status-badge";

type TaskStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";

type AdminTask = {
  id: string;
  type: string;
  status: TaskStatus;
  errorText: string | null;
  cancelRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
  project: {
    id: string;
    title: string;
    owner: {
      id: string;
      username: string;
    };
  };
  createdBy: {
    id: string;
    username: string;
  };
  retryHistory: Array<{
    id: string;
    status: TaskStatus;
    retryCount: number;
    errorText: string | null;
    createdAt: string;
  }>;
};

type PaginationInfo = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type TasksPayload = {
  tasks: AdminTask[];
  pagination: PaginationInfo;
};

type AdminTaskActionPayload =
  | {
      taskId: string;
      status: TaskStatus;
      cancelRequestedAt: string | null;
    }
  | {
      error?: string;
    };

const STATUS_ORDER: TaskStatus[] = ["FAILED", "RUNNING", "QUEUED", "SUCCEEDED", "CANCELED"];

function formatStatus(status: TaskStatus) {
  if (status === "FAILED") {
    return "失败";
  }

  if (status === "RUNNING") {
    return "运行中";
  }

  if (status === "QUEUED") {
    return "排队中";
  }

  if (status === "SUCCEEDED") {
    return "成功";
  }

  return "已取消";
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "未设置";
  }

  return new Date(value).toLocaleString();
}

function toStatusTone(status: TaskStatus) {
  if (status === "FAILED") {
    return "danger";
  }

  if (status === "RUNNING") {
    return "active";
  }

  if (status === "QUEUED") {
    return "warning";
  }

  if (status === "SUCCEEDED") {
    return "success";
  }

  return "neutral";
}

export default function AdminTasksPage() {
  const [tasks, setTasks] = useState<AdminTask[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({ page: 1, pageSize: 50, total: 0, totalPages: 0 });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingActionTaskId, setPendingActionTaskId] = useState<string | null>(null);

  async function fetchTasks(page = 1) {
    const response = await fetch(`/api/admin/tasks?page=${page}&pageSize=50`, { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as TasksPayload | { error?: string } | null;

    if (!response.ok) {
      if (payload && "error" in payload) {
        throw new Error(payload.error ?? "加载任务失败");
      }

      throw new Error("加载任务失败");
    }

    return payload as TasksPayload;
  }

  async function loadTasks(page?: number) {
    const result = await fetchTasks(page ?? pagination.page);
    setTasks(result.tasks);
    setPagination(result.pagination);
  }

  useEffect(() => {
    let isActive = true;

    async function runInitialLoad() {
      try {
        const result = await fetchTasks(1);

        if (!isActive) {
          return;
        }

        setTasks(result.tasks);
        setPagination(result.pagination);
      } catch (loadError) {
        if (!isActive) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "加载任务失败");
      }
    }

    void runInitialLoad();

    return () => {
      isActive = false;
    };
  }, []);

  async function retryTask(taskId: string) {
    setMessage(null);
    setError(null);
    setPendingActionTaskId(taskId);

    try {
      const response = await fetch(`/api/admin/tasks/${taskId}/retry`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "任务重试失败");
      }

      setMessage(`任务 ${taskId} 已重新入队。`);
      await loadTasks();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "任务重试失败");
    } finally {
      setPendingActionTaskId(null);
    }
  }

  async function cancelTask(taskId: string) {
    setMessage(null);
    setError(null);
    setPendingActionTaskId(taskId);

    try {
      const response = await fetch(`/api/admin/tasks/${taskId}/cancel`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as AdminTaskActionPayload | null;
      const errorMessage =
        payload && "error" in payload ? payload.error : undefined;

      if (!response.ok) {
        throw new Error(errorMessage ?? "取消任务失败");
      }

      if (!payload || !("status" in payload)) {
        setMessage(`已提交取消请求：${taskId}。`);
        await loadTasks();
        return;
      }

      if (payload.status === "RUNNING" || payload.status === "QUEUED") {
        setMessage(`已提交取消请求：${payload.taskId}。`);
      } else if (payload.status === "CANCELED") {
        setMessage(`任务 ${payload.taskId} 已取消。`);
      } else {
        setMessage(`任务 ${payload.taskId} 已结束，当前状态为${formatStatus(payload.status)}。`);
      }

      await loadTasks();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "取消任务失败");
    } finally {
      setPendingActionTaskId(null);
    }
  }

  const counts = STATUS_ORDER.map((status) => ({
    status,
    count: tasks.filter((task) => task.status === status).length,
  }));

  return (
    <section style={pageStyle}>
      <header style={headerStyle}>
        <p style={eyebrowStyle}>任务监控</p>
        <h2 style={titleStyle}>任务监控</h2>
        <p style={copyStyle}>查看任务状态，支持重试失败任务并取消排队或运行中的任务。</p>
      </header>

      {message ? <p style={messageStyle}>{message}</p> : null}
      {error ? <p style={errorStyle}>{error}</p> : null}

      <section style={summaryGridStyle}>
        {counts.map((entry) => (
          <article key={entry.status} style={summaryCardStyle}>
            <p style={summaryLabelStyle}>{formatStatus(entry.status)}</p>
            <strong style={summaryValueStyle}>{entry.count}</strong>
          </article>
        ))}
      </section>

      <section style={panelStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionTitleWrapStyle}>
            <h3 style={panelTitleStyle}>任务列表（共 {pagination.total} 条）</h3>
            <p style={copyStyle}>
              第 {pagination.page} / {pagination.totalPages || 1} 页，每页 {pagination.pageSize} 条
            </p>
          </div>
          <button type="button" style={secondaryButtonStyle} onClick={() => void loadTasks()}>
            刷新
          </button>
        </div>

        <div style={listStyle}>
          {tasks.length === 0 ? <p style={copyStyle}>暂无任务。</p> : null}
          {tasks.map((task) => {
            const canRetry = task.status === "FAILED" || task.status === "CANCELED";
            const canCancel = task.status === "QUEUED" || task.status === "RUNNING";

            return (
              <article key={task.id} style={itemStyle}>
                <div style={itemContentStyle}>
                  <div style={itemHeaderStyle}>
                    <strong>{task.id}</strong>
                    <StatusBadge label={formatStatus(task.status)} tone={toStatusTone(task.status)} />
                  </div>
                  <p style={metaStyle}>
                    {task.type} / {task.project.title} / owner {task.project.owner.username}
                  </p>
                  <p style={metaStyle}>
                    创建：{formatTimestamp(task.createdAt)} / 更新：{formatTimestamp(task.updatedAt)}
                  </p>
                  {task.errorText ? <p style={errorHintStyle}>失败原因：{task.errorText}</p> : null}
                  {task.cancelRequestedAt ? (
                    <p style={metaStyle}>取消请求时间：{formatTimestamp(task.cancelRequestedAt)}</p>
                  ) : null}
                  <div style={historyWrapStyle}>
                    <p style={historyTitleStyle}>重试历史</p>
                    <div style={historyListStyle}>
                      {task.retryHistory.map((step) => (
                        <span key={step.id} style={historyChipStyle}>
                          {formatStatus(step.status)} #{step.retryCount}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={actionsStyle}>
                  {canRetry ? (
                    <button
                      type="button"
                      style={primaryButtonStyle}
                      onClick={() => void retryTask(task.id)}
                      disabled={pendingActionTaskId === task.id}
                    >
                      重试任务
                    </button>
                  ) : null}
                  {canCancel ? (
                    <button
                      type="button"
                      style={dangerButtonStyle}
                      onClick={() => void cancelTask(task.id)}
                      disabled={pendingActionTaskId === task.id}
                    >
                      取消任务
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>

        {pagination.totalPages > 1 ? (
          <div style={paginationStyle}>
            <button
              type="button"
              style={secondaryButtonStyle}
              disabled={pagination.page <= 1}
              onClick={() => void loadTasks(pagination.page - 1)}
            >
              上一页
            </button>
            <span style={copyStyle}>
              第 {pagination.page} / {pagination.totalPages} 页
            </span>
            <button
              type="button"
              style={secondaryButtonStyle}
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => void loadTasks(pagination.page + 1)}
            >
              下一页
            </button>
          </div>
        ) : null}
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

const summaryGridStyle = {
  display: "grid",
  gap: "10px",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
} satisfies CSSProperties;

const summaryCardStyle = {
  borderRadius: "14px",
  padding: "14px",
  border: "1px solid var(--border)",
  background: "rgba(15, 15, 35, 0.56)",
} satisfies CSSProperties;

const summaryLabelStyle = {
  margin: 0,
  color: "var(--text-muted)",
} satisfies CSSProperties;

const summaryValueStyle = {
  display: "block",
  marginTop: "8px",
  fontSize: "1.6rem",
} satisfies CSSProperties;

const panelStyle = {
  borderRadius: "20px",
  border: "1px solid var(--border)",
  background: "rgba(22, 24, 39, 0.82)",
  padding: "18px",
} satisfies CSSProperties;

const sectionHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "10px",
  alignItems: "center",
} satisfies CSSProperties;

const sectionTitleWrapStyle = {
  display: "grid",
  gap: "6px",
} satisfies CSSProperties;

const panelTitleStyle = {
  margin: 0,
  fontSize: "1.06rem",
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
  padding: "12px",
  borderRadius: "14px",
  border: "1px solid var(--border)",
  background: "rgba(15, 15, 35, 0.56)",
} satisfies CSSProperties;

const itemContentStyle = {
  display: "grid",
  gap: "6px",
} satisfies CSSProperties;

const itemHeaderStyle = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  alignItems: "center",
} satisfies CSSProperties;

const metaStyle = {
  margin: 0,
  color: "var(--text-muted)",
  fontSize: "0.92rem",
} satisfies CSSProperties;

const errorHintStyle = {
  margin: 0,
  color: "#fda4af",
  fontWeight: 600,
  fontSize: "0.92rem",
} satisfies CSSProperties;

const historyWrapStyle = {
  display: "grid",
  gap: "6px",
  marginTop: "2px",
} satisfies CSSProperties;

const historyTitleStyle = {
  margin: 0,
  fontWeight: 700,
  fontSize: "0.92rem",
} satisfies CSSProperties;

const historyListStyle = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
} satisfies CSSProperties;

const historyChipStyle = {
  padding: "5px 10px",
  borderRadius: "999px",
  border: "1px solid var(--border)",
  background: "rgba(248, 250, 252, 0.06)",
  fontSize: "0.86rem",
} satisfies CSSProperties;

const paginationStyle = {
  display: "flex",
  gap: "12px",
  justifyContent: "center",
  alignItems: "center",
  marginTop: "16px",
} satisfies CSSProperties;

const actionsStyle = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  justifyContent: "flex-end",
  alignItems: "flex-start",
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
