import type { CSSProperties } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/guards";
import { getProject } from "@/lib/services/projects";

type PageProps = {
  params: Promise<{ projectId: string }> | { projectId: string };
};

export default async function ProjectDetailPage({ params }: PageProps) {
  const [{ projectId }, user] = await Promise.all([
    Promise.resolve(params),
    requireUser(),
  ]);
  const project = await getProject(projectId, user.userId);

  return (
    <section style={pageStyle}>
      <header style={heroStyle}>
        <div style={heroContentStyle}>
          <p style={eyebrowStyle}>Project Detail</p>
          <h2 style={titleStyle}>{project.title}</h2>
          <p style={copyStyle}>
            This route provides the project-level landing page for active
            workflows. Start from here when moving into script generation or
            back out of a workflow.
          </p>
        </div>
        <div style={actionsStyle}>
          <Link href="/workspace" style={secondaryLinkStyle}>
            Back to workspace
          </Link>
          <Link href={`/projects/${project.id}/script`} style={primaryLinkStyle}>
            Open script workflow
          </Link>
        </div>
      </header>

      <div style={summaryGridStyle}>
        <article style={cardStyle}>
          <p style={labelStyle}>Title</p>
          <strong style={valueStyle}>{project.title}</strong>
        </article>
        <article style={cardStyle}>
          <p style={labelStyle}>Status</p>
          <strong style={valueStyle}>{project.status}</strong>
        </article>
        <article style={cardStyle}>
          <p style={labelStyle}>Project ID</p>
          <strong style={valueStyle}>{project.id}</strong>
        </article>
      </div>

      <article style={cardStyle}>
        <h3 style={sectionTitleStyle}>Idea</h3>
        <p style={copyStyle}>
          {project.idea?.trim() || "No idea has been recorded for this project yet."}
        </p>
      </article>

      <article style={cardStyle}>
        <h3 style={sectionTitleStyle}>Available workflows</h3>
        <div style={workflowListStyle}>
          <Link href={`/projects/${project.id}/script`} style={workflowLinkStyle}>
            Script workflow
          </Link>
          <p style={workflowMetaStyle}>
            Use the guided Q&A flow to turn the project idea into a script task.
          </p>
        </div>
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
} satisfies CSSProperties;

const summaryGridStyle = {
  display: "grid",
  gap: "16px",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
} satisfies CSSProperties;

const cardStyle = {
  display: "grid",
  gap: "12px",
  padding: "20px",
  borderRadius: "24px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
  background: "rgba(255, 250, 243, 0.88)",
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

const workflowListStyle = {
  display: "grid",
  gap: "8px",
} satisfies CSSProperties;

const workflowLinkStyle = {
  color: "#8c5f2d",
  fontWeight: 700,
  textDecoration: "none",
} satisfies CSSProperties;

const workflowMetaStyle = {
  margin: 0,
  color: "#665d52",
  lineHeight: 1.6,
} satisfies CSSProperties;
