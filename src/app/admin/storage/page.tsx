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
        throw new Error(payload.error ?? "Failed to load storage stats");
      }

      throw new Error("Failed to load storage stats");
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

        setError(loadError instanceof Error ? loadError.message : "Failed to load storage stats");
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
        throw new Error(payload && "error" in payload ? payload.error ?? "Failed to clean up storage" : "Failed to clean up storage");
      }

      const cleanupResult = payload as CleanupResult;
      setMessage(`Deleted ${cleanupResult.deletedFiles} files and reclaimed ${formatBytes(cleanupResult.freedBytes)}.`);
      await loadStats();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to clean up storage");
    } finally {
      setIsCleaningUp(false);
    }
  }

  return (
    <section style={pageStyle}>
      <header>
        <p style={eyebrowStyle}>Operations</p>
        <h2 style={titleStyle}>Storage Management</h2>
        <p style={copyStyle}>
          Track directory usage, keep an eye on free disk space, and remove 30-day-old cache and
          intermediate artifacts without touching referenced assets.
        </p>
      </header>

      {message ? <p style={messageStyle}>{message}</p> : null}
      {error ? <p style={errorStyle}>{error}</p> : null}

      <section style={summaryGridStyle}>
        <article style={heroCardStyle}>
          <p style={summaryLabelStyle}>Free disk space</p>
          <strong style={heroValueStyle}>{formatBytes(stats?.freeBytes ?? 0)}</strong>
          <p style={copyStyle}>Total capacity {formatBytes(stats?.totalBytes ?? 0)}</p>
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
          <div>
            <h3 style={panelTitleStyle}>Cleanup</h3>
            <p style={copyStyle}>
              Remove task cache images and intermediate artifacts older than 30 days.
            </p>
          </div>
          <button type="button" style={buttonStyle} onClick={() => void cleanupOldCache()} disabled={isCleaningUp}>
            Clean 30-day cache
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
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
} satisfies CSSProperties;

const heroCardStyle = {
  gridColumn: "span 2",
  borderRadius: "24px",
  padding: "22px",
  background: "linear-gradient(135deg, rgba(140, 95, 45, 0.16), rgba(255, 250, 243, 0.96))",
  border: "1px solid rgba(31, 27, 22, 0.08)",
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

const heroValueStyle = {
  display: "block",
  marginTop: "12px",
  fontSize: "2.4rem",
} satisfies CSSProperties;

const summaryValueStyle = {
  display: "block",
  marginTop: "10px",
  fontSize: "1.8rem",
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
