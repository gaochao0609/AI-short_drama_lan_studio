import type { ReactNode } from "react";

export type MetricCardProps = {
  label: string;
  value: ReactNode;
  detail?: string;
};

export default function MetricCard({
  label,
  value,
  detail,
}: Readonly<MetricCardProps>) {
  return (
    <article className="studio-metric-card">
      <p className="studio-metric-card__label">{label}</p>
      <strong className="studio-metric-card__value">{value}</strong>
      {detail ? <p className="studio-metric-card__detail">{detail}</p> : null}
    </article>
  );
}
