"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

type StorageStats = {
  totalBytes: number;
  freeBytes: number;
  uploadsBytes: number;
  imagesBytes: number;
  videosBytes: number;
  exportsBytes: number;
};

type CleanupResult = {
  deletedFiles: number;
  freedBytes: number;
};

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let nextValue = value;
  let unitIndex = 0;

  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }

  const digits = nextValue >= 10 || unitIndex === 0 ? 0 : 1;
  return `${nextValue.toFixed(digits)} ${units[unitIndex]}`;
}

export default function AdminStoragePage() {
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCleaningUp, setIsCleaningUp] = useState(false);

  async function fetchStats() {
    const response = await fetch("/api/admin/storage", { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as StorageStats | { error?: string } | null;

    if (!response.ok) {
      if (payload && "error" in payload) {
        throw new Error(payload.error ?? "加载存储统计失败");
      }

      throw new Error("加载存储统计失败");
    }

    return payload as StorageStats;
  }

  async function loadStats() {
    const nextStats = await fetchStats();
    setStats(nextStats);
  }

  useEffect(() => {
    let isActive = true;

    async function runInitialLoad() {
      try {
        const nextStats = await fetchStats();

        if (!isActive) {
          return;
        }

        setStats(nextStats);
      } catch (loadError) {
        if (!isActive) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "加载存储统计失败");
      }
    }

    void runInitialLoad();

    return () => {
      isActive = false;
    };
  }, []);

  async function cleanupOldCache() {
    setMessage(null);
    setError(null);
    setIsCleaningUp(true);

    try {
      const response = await fetch("/api/admin/storage/cleanup", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ olderThanDays: 30 }),
      });
      const payload = (await response.json().catch(() => null)) as CleanupResult | { error?: string } | null;

      if (!response.ok) {
        throw new Error(payload && "error" in payload ? payload.error ?? "清理存储失败" : "清理存储失败");
      }

      const cleanupResult = payload as CleanupResult;
      setMessage(`已删除 ${cleanupResult.deletedFiles} 个文件，释放 ${formatBytes(cleanupResult.freedBytes)}。`);
      await loadStats();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "清理存储失败");
    } finally {
      setIsCleaningUp(false);
    }
  }

  return (
    <section style={pageStyle}>
      <header style={headerStyle}>
        <p style={eyebrowStyle}>存储管理</p>
        <h2 style={titleStyle}>存储管理</h2>
        <p style={copyStyle}>
          查看目录占用和剩余空间，可安全清理 30 天前的缓存与中间产物，不影响已归档资产。
        </p>
      </header>

      {message ? <p style={messageStyle}>{message}</p> : null}
      {error ? <p style={errorStyle}>{error}</p> : null}

      <section style={summaryGridStyle}>
        <article style={heroCardStyle}>
          <p style={summaryLabelStyle}>可用磁盘空间</p>
          <strong style={heroValueStyle}>{formatBytes(stats?.freeBytes ?? 0)}</strong>
          <p style={copyStyle}>总容量 {formatBytes(stats?.totalBytes ?? 0)}</p>
        </article>
        <article style={summaryCardStyle}>
          <p style={summaryLabelStyle}>uploads</p>
          <strong style={summaryValueStyle}>{formatBytes(stats?.uploadsBytes ?? 0)}</strong>
        </article>
        <article style={summaryCardStyle}>
          <p style={summaryLabelStyle}>generated-images</p>
          <strong style={summaryValueStyle}>{formatBytes(stats?.imagesBytes ?? 0)}</strong>
        </article>
        <article style={summaryCardStyle}>
          <p style={summaryLabelStyle}>generated-videos</p>
          <strong style={summaryValueStyle}>{formatBytes(stats?.videosBytes ?? 0)}</strong>
        </article>
        <article style={summaryCardStyle}>
          <p style={summaryLabelStyle}>exports</p>
          <strong style={summaryValueStyle}>{formatBytes(stats?.exportsBytes ?? 0)}</strong>
        </article>
      </section>

      <section style={panelStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionTitleWrapStyle}>
            <h3 style={panelTitleStyle}>缓存清理</h3>
            <p style={copyStyle}>删除 30 天前的任务缓存图与中间产物。</p>
          </div>
          <button type="button" style={primaryButtonStyle} onClick={() => void cleanupOldCache()} disabled={isCleaningUp}>
            清理 30 天缓存
          </button>
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

const summaryGridStyle = {
  display: "grid",
  gap: "10px",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
} satisfies CSSProperties;

const heroCardStyle = {
  gridColumn: "span 2",
  borderRadius: "14px",
  padding: "16px",
  border: "1px solid var(--border)",
  background: "rgba(15, 15, 35, 0.56)",
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

const heroValueStyle = {
  display: "block",
  marginTop: "8px",
  fontSize: "2rem",
} satisfies CSSProperties;

const summaryValueStyle = {
  display: "block",
  marginTop: "8px",
  fontSize: "1.4rem",
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
