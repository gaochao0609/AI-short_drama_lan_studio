import type { ReactNode } from "react";

export type MetricCardProps = {
  label: string;
  value: ReactNode;
  detail?: string;
  emphasis?: ReactNode;
};

export default function MetricCard({
  label,
  value,
  detail,
  emphasis,
}: Readonly<MetricCardProps>) {
  return (
    <article className="studio-metric-card">
      <p className="studio-metric-card__label">{label}</p>
      <strong className="studio-metric-card__value">{value}</strong>
      {detail ? <p className="studio-metric-card__detail">{detail}</p> : null}
      {emphasis ? <div style={emphasisStyle}>{emphasis}</div> : null}
    </article>
  );
}

const emphasisStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  alignItems: "center",
  color: "var(--text)",
  fontWeight: 600,
} as const;
