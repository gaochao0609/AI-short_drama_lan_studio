"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

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

type TasksPayload = {
  tasks: AdminTask[];
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
    return "Failed";
  }

  if (status === "RUNNING") {
    return "Running";
  }

  if (status === "QUEUED") {
    return "Queued";
  }

  if (status === "SUCCEEDED") {
    return "Succeeded";
  }

  return "Canceled";
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Not set";
  }

  return new Date(value).toLocaleString();
}

export default function AdminTasksPage() {
  const [tasks, setTasks] = useState<AdminTask[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingActionTaskId, setPendingActionTaskId] = useState<string | null>(null);

  async function fetchTasks() {
    const response = await fetch("/api/admin/tasks", { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as TasksPayload | { error?: string } | null;

    if (!response.ok) {
      if (payload && "error" in payload) {
        throw new Error(payload.error ?? "Failed to load admin tasks");
      }

      throw new Error("Failed to load admin tasks");
    }

    return (payload as TasksPayload).tasks;
  }

  async function loadTasks() {
    const nextTasks = await fetchTasks();
    setTasks(nextTasks);
  }

  useEffect(() => {
    let isActive = true;

    async function runInitialLoad() {
      try {
        const nextTasks = await fetchTasks();

        if (!isActive) {
          return;
        }

        setTasks(nextTasks);
      } catch (loadError) {
        if (!isActive) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "Failed to load admin tasks");
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
        throw new Error(payload?.error ?? "Failed to retry task");
      }

      setMessage(`Task ${taskId} requeued.`);
      await loadTasks();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to retry task");
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
        throw new Error(errorMessage ?? "Failed to cancel task");
      }

      if (!payload || !("status" in payload)) {
        setMessage(`Cancel request submitted for ${taskId}.`);
        await loadTasks();
        return;
      }

      if (payload.status === "RUNNING" || payload.status === "QUEUED") {
        setMessage(`Cancel request submitted for ${payload.taskId}.`);
      } else if (payload.status === "CANCELED") {
        setMessage(`Task ${payload.taskId} canceled.`);
      } else {
        setMessage(`Task ${payload.taskId} already finished as ${formatStatus(payload.status)}.`);
      }

      await loadTasks();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to cancel task");
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
      <header>
        <p style={eyebrowStyle}>Operations</p>
        <h2 style={titleStyle}>Task Monitoring</h2>
        <p style={copyStyle}>
          Review queued, running, failed, and completed jobs. Failed jobs can be requeued, and active
          jobs can be canceled from here.
        </p>
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
          <div>
            <h3 style={panelTitleStyle}>Recent 100 tasks</h3>
            <p style={copyStyle}>
              Showing the newest 100 tasks so recent queue activity, completions, and failures stay in
              one view.
            </p>
          </div>
          <button type="button" style={secondaryButtonStyle} onClick={() => void loadTasks()}>
            Refresh
          </button>
        </div>

        <div style={listStyle}>
          {tasks.length === 0 ? <p style={copyStyle}>No tasks found.</p> : null}
          {tasks.map((task) => {
            const canRetry = task.status === "FAILED" || task.status === "CANCELED";
            const canCancel = task.status === "QUEUED" || task.status === "RUNNING";

            return (
              <article key={task.id} style={itemStyle}>
                <div style={itemContentStyle}>
                  <div style={itemHeaderStyle}>
                    <strong>{task.id}</strong>
                    <span style={statusBadgeStyle(task.status)}>{formatStatus(task.status)}</span>
                  </div>
                  <p style={metaStyle}>
                    {task.type} / {task.project.title} / owner {task.project.owner.username}
                  </p>
                  <p style={metaStyle}>
                    Created {formatTimestamp(task.createdAt)} / Updated {formatTimestamp(task.updatedAt)}
                  </p>
                  {task.errorText ? <p style={errorHintStyle}>Failure: {task.errorText}</p> : null}
                  {task.cancelRequestedAt ? (
                    <p style={metaStyle}>Cancel requested at {formatTimestamp(task.cancelRequestedAt)}</p>
                  ) : null}
                  <div style={historyWrapStyle}>
                    <p style={historyTitleStyle}>Retry history</p>
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
                      style={buttonStyle}
                      onClick={() => void retryTask(task.id)}
                      disabled={pendingActionTaskId === task.id}
                    >
                      Retry task
                    </button>
                  ) : null}
                  {canCancel ? (
                    <button
                      type="button"
                      style={dangerButtonStyle}
                      onClick={() => void cancelTask(task.id)}
                      disabled={pendingActionTaskId === task.id}
                    >
                      Cancel task
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
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

const summaryGridStyle = {
  display: "grid",
  gap: "12px",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
} satisfies CSSProperties;

const summaryCardStyle = {
  borderRadius: "18px",
  padding: "18px",
  background: "rgba(140, 95, 45, 0.08)",
  border: "1px solid rgba(31, 27, 22, 0.08)",
} satisfies CSSProperties;

const summaryLabelStyle = {
  margin: 0,
  color: "#665d52",
} satisfies CSSProperties;

const summaryValueStyle = {
  display: "block",
  marginTop: "10px",
  fontSize: "2rem",
} satisfies CSSProperties;

const panelStyle = {
  borderRadius: "24px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
  background: "rgba(255, 250, 243, 0.94)",
  padding: "20px",
} satisfies CSSProperties;

const sectionHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "center",
} satisfies CSSProperties;

const panelTitleStyle = {
  margin: 0,
  fontSize: "1.2rem",
} satisfies CSSProperties;

const listStyle = {
  display: "grid",
  gap: "12px",
  marginTop: "18px",
} satisfies CSSProperties;

const itemStyle = {
  display: "grid",
  gap: "12px",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  padding: "16px",
  borderRadius: "18px",
  background: "rgba(140, 95, 45, 0.06)",
} satisfies CSSProperties;

const itemContentStyle = {
  display: "grid",
  gap: "6px",
} satisfies CSSProperties;

const itemHeaderStyle = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
  alignItems: "center",
} satisfies CSSProperties;

const metaStyle = {
  margin: 0,
  color: "#665d52",
} satisfies CSSProperties;

const errorHintStyle = {
  margin: 0,
  color: "#b42318",
  fontWeight: 600,
} satisfies CSSProperties;

const historyWrapStyle = {
  display: "grid",
  gap: "8px",
  marginTop: "6px",
} satisfies CSSProperties;

const historyTitleStyle = {
  margin: 0,
  fontWeight: 700,
} satisfies CSSProperties;

const historyListStyle = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
} satisfies CSSProperties;

const historyChipStyle = {
  padding: "6px 10px",
  borderRadius: "999px",
  background: "#fff",
  border: "1px solid rgba(31, 27, 22, 0.12)",
  fontSize: "0.9rem",
} satisfies CSSProperties;

const actionsStyle = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  justifyContent: "flex-end",
  alignItems: "flex-start",
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

const secondaryButtonStyle = {
  ...buttonStyle,
  background: "#f0e3d1",
  color: "#4b3a27",
} satisfies CSSProperties;

const dangerButtonStyle = {
  ...buttonStyle,
  background: "#b42318",
} satisfies CSSProperties;

const messageStyle = {
  margin: 0,
  padding: "14px 16px",
  borderRadius: "16px",
  background: "rgba(23, 92, 49, 0.12)",
  color: "#175c31",
} satisfies CSSProperties;

const errorStyle = {
  margin: 0,
  padding: "14px 16px",
  borderRadius: "16px",
  background: "rgba(180, 35, 24, 0.12)",
  color: "#b42318",
} satisfies CSSProperties;

function statusBadgeStyle(status: TaskStatus): CSSProperties {
  const backgroundByStatus: Record<TaskStatus, string> = {
    FAILED: "rgba(180, 35, 24, 0.12)",
    RUNNING: "rgba(191, 90, 0, 0.12)",
    QUEUED: "rgba(140, 95, 45, 0.12)",
    SUCCEEDED: "rgba(23, 92, 49, 0.12)",
    CANCELED: "rgba(76, 76, 76, 0.12)",
  };
  const colorByStatus: Record<TaskStatus, string> = {
    FAILED: "#b42318",
    RUNNING: "#9a4d00",
    QUEUED: "#8c5f2d",
    SUCCEEDED: "#175c31",
    CANCELED: "#454545",
  };

  return {
    borderRadius: "999px",
    padding: "6px 10px",
    fontWeight: 700,
    background: backgroundByStatus[status],
    color: colorByStatus[status],
  };
}
