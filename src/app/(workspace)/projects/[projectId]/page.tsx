import type { CSSProperties } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/guards";
import { getProjectDetail } from "@/lib/services/projects";

type PageProps = {
  params: Promise<{ projectId: string }> | { projectId: string };
};

function formatDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);

  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatSize(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function ProjectDetailPage({ params }: PageProps) {
  const [{ projectId }, user] = await Promise.all([
    Promise.resolve(params),
    requireUser(),
  ]);
  const project = await getProjectDetail(projectId, user.userId);

  return (
    <section style={pageStyle}>
      <header style={heroStyle}>
        <div style={heroContentStyle}>
          <p style={eyebrowStyle}>Project Detail</p>
          <h2 style={titleStyle}>{project.title}</h2>
          <p style={copyStyle}>
            {project.idea?.trim() || "No idea has been recorded for this project yet."}
          </p>
        </div>
        <div style={actionsStyle}>
          <Link href="/workspace" style={secondaryLinkStyle}>
            Back to workspace
          </Link>
          <Link href={`/projects/${project.id}/script`} style={primaryLinkStyle}>
            Open script workflow
          </Link>
          <Link href={`/projects/${project.id}/storyboard`} style={secondaryLinkStyle}>
            Open storyboard workflow
          </Link>
          <Link href={`/projects/${project.id}/images`} style={secondaryLinkStyle}>
            Open image workflow
          </Link>
          <Link href={`/projects/${project.id}/videos`} style={secondaryLinkStyle}>
            Open video workflow
          </Link>
        </div>
      </header>

      <div style={summaryGridStyle}>
        <article style={cardStyle}>
          <p style={labelStyle}>Status</p>
          <strong style={valueStyle}>{project.status}</strong>
        </article>
        <article style={cardStyle}>
          <p style={labelStyle}>Updated</p>
          <strong style={valueStyle}>{formatDate(project.updatedAt)}</strong>
        </article>
        <article style={cardStyle}>
          <p style={labelStyle}>Project ID</p>
          <strong style={smallValueStyle}>{project.id}</strong>
        </article>
      </div>

      <div style={sectionGridStyle}>
        <article style={cardStyle}>
          <h3 style={sectionTitleStyle}>Script Versions</h3>
          {project.scriptVersions.length === 0 ? (
            <p style={emptyStyle}>No script versions yet.</p>
          ) : (
            <div style={stackStyle}>
              {project.scriptVersions.map((version) => (
                <div key={version.id} style={itemCardStyle}>
                  <strong>Version {version.versionNumber}</strong>
                  <span style={metaStyle}>{formatDate(version.createdAt)}</span>
                  <p style={bodyStyle}>{version.body?.trim() || "No script body recorded."}</p>
                </div>
              ))}
            </div>
          )}
        </article>

        <article style={cardStyle}>
          <h3 style={sectionTitleStyle}>Storyboard Versions</h3>
          {project.storyboardVersions.length === 0 ? (
            <p style={emptyStyle}>No storyboard versions yet.</p>
          ) : (
            <div style={stackStyle}>
              {project.storyboardVersions.map((version) => (
                <div key={version.id} style={itemCardStyle}>
                  <strong>{version.frameCount} frames</strong>
                  <span style={metaStyle}>Script {version.scriptVersionId}</span>
                  <span style={metaStyle}>{formatDate(version.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>

      <div style={sectionGridStyle}>
        <article style={cardStyle}>
          <h3 style={sectionTitleStyle}>Image Assets</h3>
          {project.imageAssets.length === 0 ? (
            <p style={emptyStyle}>No image assets yet.</p>
          ) : (
            <div style={assetGridStyle}>
              {project.imageAssets.map((asset) => (
                <div key={asset.id} style={assetCardStyle}>
                  {asset.previewDataUrl ? (
                    <img src={asset.previewDataUrl} alt={asset.originalName ?? asset.id} style={imageStyle} />
                  ) : (
                    <div style={placeholderStyle}>Preview unavailable</div>
                  )}
                  <strong style={smallValueStyle}>{asset.id}</strong>
                  <span style={metaStyle}>
                    {asset.mimeType} · {formatSize(asset.sizeBytes)}
                  </span>
                  <Link href={asset.downloadUrl} style={downloadLinkStyle}>
                    Download {asset.originalName ?? asset.id}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </article>

        <article style={cardStyle}>
          <h3 style={sectionTitleStyle}>Video Assets</h3>
          {project.videoAssets.length === 0 ? (
            <p style={emptyStyle}>No video assets yet.</p>
          ) : (
            <div style={assetGridStyle}>
              {project.videoAssets.map((asset) => (
                <div key={asset.id} style={assetCardStyle}>
                  {asset.previewUrl ? (
                    <video controls preload="metadata" src={asset.previewUrl} style={videoStyle} />
                  ) : (
                    <div style={placeholderStyle}>Preview unavailable</div>
                  )}
                  <strong style={smallValueStyle}>{asset.id}</strong>
                  <span style={metaStyle}>
                    {asset.mimeType} · {formatSize(asset.sizeBytes)}
                  </span>
                  <Link href={asset.downloadUrl} style={downloadLinkStyle}>
                    Download {asset.originalName ?? asset.id}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>

      <article style={cardStyle}>
        <h3 style={sectionTitleStyle}>Task History</h3>
        {project.taskHistory.length === 0 ? (
          <p style={emptyStyle}>No tasks recorded yet.</p>
        ) : (
          <div style={stackStyle}>
            {project.taskHistory.map((task) => (
              <div key={task.id} style={itemCardStyle}>
                <strong>{task.id}</strong>
                <span style={metaStyle}>
                  {task.type} · {task.status}
                </span>
                <span style={metaStyle}>Created {formatDate(task.createdAt)}</span>
                {task.finishedAt ? <span style={metaStyle}>Finished {formatDate(task.finishedAt)}</span> : null}
                {task.errorText ? <p style={errorStyle}>{task.errorText}</p> : null}
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}

const pageStyle = {
  display: "grid",
  gap: "20px",
} satisfies CSSProperties;

const heroStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "16px",
  padding: "24px",
  borderRadius: "24px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
  background: "rgba(255, 250, 243, 0.92)",
} satisfies CSSProperties;

const heroContentStyle = {
  display: "grid",
  gap: "10px",
  maxWidth: "720px",
} satisfies CSSProperties;

const eyebrowStyle = {
  margin: 0,
  color: "#8c5f2d",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  fontSize: "0.8rem",
} satisfies CSSProperties;

const titleStyle = {
  margin: 0,
  fontSize: "2rem",
} satisfies CSSProperties;

const copyStyle = {
  margin: 0,
  color: "#665d52",
  lineHeight: 1.6,
} satisfies CSSProperties;

const actionsStyle = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
  justifyContent: "flex-end",
} satisfies CSSProperties;

const summaryGridStyle = {
  display: "grid",
  gap: "16px",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
} satisfies CSSProperties;

const sectionGridStyle = {
  display: "grid",
  gap: "20px",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
} satisfies CSSProperties;

const cardStyle = {
  display: "grid",
  gap: "14px",
  padding: "20px",
  borderRadius: "24px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
  background: "rgba(255, 250, 243, 0.88)",
} satisfies CSSProperties;

const itemCardStyle = {
  display: "grid",
  gap: "6px",
  padding: "14px",
  borderRadius: "18px",
  background: "rgba(255, 255, 255, 0.72)",
  border: "1px solid rgba(31, 27, 22, 0.08)",
} satisfies CSSProperties;

const assetCardStyle = {
  ...itemCardStyle,
  alignContent: "start",
} satisfies CSSProperties;

const labelStyle = {
  margin: 0,
  color: "#665d52",
  fontSize: "0.9rem",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
} satisfies CSSProperties;

const valueStyle = {
  fontSize: "1.1rem",
} satisfies CSSProperties;

const smallValueStyle = {
  fontSize: "0.95rem",
  wordBreak: "break-word",
} satisfies CSSProperties;

const sectionTitleStyle = {
  margin: 0,
  fontSize: "1.1rem",
} satisfies CSSProperties;

const primaryLinkStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "999px",
  padding: "12px 18px",
  textDecoration: "none",
  background: "#8c5f2d",
  color: "#fff",
  fontWeight: 700,
} satisfies CSSProperties;

const secondaryLinkStyle = {
  ...primaryLinkStyle,
  background: "rgba(140, 95, 45, 0.12)",
  color: "#4b3a27",
} satisfies CSSProperties;

const downloadLinkStyle = {
  color: "#8c5f2d",
  fontWeight: 700,
  textDecoration: "none",
} satisfies CSSProperties;

const emptyStyle = {
  margin: 0,
  color: "#665d52",
} satisfies CSSProperties;

const stackStyle = {
  display: "grid",
  gap: "12px",
} satisfies CSSProperties;

const assetGridStyle = {
  display: "grid",
  gap: "14px",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
} satisfies CSSProperties;

const metaStyle = {
  color: "#665d52",
  fontSize: "0.9rem",
} satisfies CSSProperties;

const bodyStyle = {
  margin: 0,
  color: "#332b21",
  lineHeight: 1.6,
  whiteSpace: "pre-wrap",
} satisfies CSSProperties;

const placeholderStyle = {
  width: "100%",
  height: "180px",
  borderRadius: "14px",
  border: "1px dashed rgba(31, 27, 22, 0.22)",
  background: "rgba(255, 250, 243, 0.65)",
  display: "grid",
  placeItems: "center",
  color: "#665d52",
} satisfies CSSProperties;

const imageStyle = {
  width: "100%",
  height: "180px",
  objectFit: "cover",
  borderRadius: "14px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
} satisfies CSSProperties;

const videoStyle = {
  width: "100%",
  height: "180px",
  objectFit: "cover",
  borderRadius: "14px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
  background: "#000",
} satisfies CSSProperties;

const errorStyle = {
  margin: 0,
  color: "#a11d1d",
  fontWeight: 700,
} satisfies CSSProperties;
