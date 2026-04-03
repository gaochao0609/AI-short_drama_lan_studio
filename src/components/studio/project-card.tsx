import Link from "next/link";
import StatusBadge from "@/components/studio/status-badge";
import type { StatusBadgeProps } from "@/components/studio/status-badge";

export type ProjectCardProps = {
  title: string;
  summary: string;
  status: string;
  statusTone?: StatusBadgeProps["tone"];
  updatedAtLabel: string;
  currentPhase: string;
  nextActionLabel: string;
  nextActionCtaLabel: string;
  nextActionHref: string;
};

export default function ProjectCard({
  title,
  summary,
  status,
  statusTone = "active",
  updatedAtLabel,
  currentPhase,
  nextActionLabel,
  nextActionCtaLabel,
  nextActionHref,
}: Readonly<ProjectCardProps>) {
  const actionAriaLabel = `${nextActionCtaLabel}：${title}`;

  return (
    <article className="studio-project-card">
      <div className="studio-project-card__header">
        <h2 className="studio-project-card__title">{title}</h2>
        <StatusBadge label={status} tone={statusTone} />
      </div>
      <p className="studio-project-card__summary">{summary}</p>
      <div className="studio-project-card__meta">
        <span>{updatedAtLabel}</span>
        <span>{currentPhase}</span>
      </div>
      <div style={footerStyle}>
        <span style={actionHintStyle}>{nextActionLabel}</span>
        <Link
          href={nextActionHref}
          aria-label={actionAriaLabel}
          style={actionLinkStyle}
        >
          {nextActionCtaLabel}
        </Link>
      </div>
    </article>
  );
}

const footerStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  flexWrap: "wrap",
} as const;

const actionHintStyle = {
  color: "var(--text)",
  fontWeight: 600,
} as const;

const actionLinkStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "38px",
  padding: "0 16px",
  borderRadius: "999px",
  background: "rgba(109, 94, 252, 0.2)",
  border: "1px solid rgba(109, 94, 252, 0.36)",
  color: "var(--text)",
  textDecoration: "none",
  fontWeight: 600,
} as const;
