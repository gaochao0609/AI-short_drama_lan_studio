import Link from "next/link";
import StatusBadge from "@/components/studio/status-badge";

export type WorkflowRailItem = {
  label: string;
  detail?: string;
  summary?: string;
  badgeLabel?: string;
  tone?: "neutral" | "active" | "warning" | "danger";
  href?: string;
  ctaLabel?: string;
};

export type WorkflowRailProps = {
  title?: string;
  items: WorkflowRailItem[];
  layout?: "list" | "cards";
};

export default function WorkflowRail({
  title,
  items,
  layout = "list",
}: Readonly<WorkflowRailProps>) {
  if (layout === "cards") {
    return (
      <section className="studio-workflow-rail" aria-label={title ?? "Workflow rail"}>
        {title ? <p className="studio-workflow-rail__title">{title}</p> : null}
        <ol style={cardListStyle}>
          {items.map((item, index) => (
            <li key={item.label} style={cardItemStyle}>
              <div style={cardHeaderStyle}>
                <span className="studio-workflow-rail__index">{index + 1}</span>
                {item.badgeLabel ? (
                  <StatusBadge label={item.badgeLabel} tone={item.tone ?? "neutral"} />
                ) : null}
              </div>
              <div style={cardCopyStyle}>
                <strong className="studio-workflow-rail__label">{item.label}</strong>
                {item.detail ? (
                  <p style={cardDetailStyle}>{item.detail}</p>
                ) : null}
                {item.summary ? (
                  <p style={cardSummaryStyle}>{item.summary}</p>
                ) : null}
              </div>
              {item.href && item.ctaLabel ? (
                <Link href={item.href} style={cardLinkStyle}>
                  {item.ctaLabel}
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    );
  }

  return (
    <section className="studio-workflow-rail" aria-label={title ?? "Workflow rail"}>
      {title ? <p className="studio-workflow-rail__title">{title}</p> : null}
      <ol className="studio-workflow-rail__list">
        {items.map((item, index) => (
          <li key={item.label} className="studio-workflow-rail__item">
            <span className="studio-workflow-rail__index">{index + 1}</span>
            <div className="studio-workflow-rail__copy">
              <span className="studio-workflow-rail__label">{item.label}</span>
              {item.detail ? (
                <span className="studio-workflow-rail__detail">{item.detail}</span>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

const cardListStyle = {
  listStyle: "none",
  display: "grid",
  gap: "16px",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  margin: "16px 0 0",
  padding: 0,
} as const;

const cardItemStyle = {
  display: "grid",
  gap: "16px",
  alignContent: "start",
  minHeight: "100%",
  padding: "18px",
  borderRadius: "22px",
  border: "1px solid rgba(129, 140, 248, 0.22)",
  background:
    "linear-gradient(180deg, rgba(31, 33, 67, 0.9), rgba(16, 19, 38, 0.94))",
} as const;

const cardHeaderStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
} as const;

const cardCopyStyle = {
  display: "grid",
  gap: "8px",
} as const;

const cardDetailStyle = {
  margin: 0,
  color: "var(--text)",
  fontWeight: 600,
  lineHeight: 1.5,
} as const;

const cardSummaryStyle = {
  margin: 0,
  color: "var(--text-muted)",
  lineHeight: 1.7,
} as const;

const cardLinkStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "fit-content",
  minHeight: "40px",
  padding: "0 16px",
  borderRadius: "999px",
  border: "1px solid rgba(129, 140, 248, 0.3)",
  background: "rgba(109, 94, 252, 0.18)",
  color: "var(--text)",
  fontWeight: 600,
  textDecoration: "none",
} as const;
