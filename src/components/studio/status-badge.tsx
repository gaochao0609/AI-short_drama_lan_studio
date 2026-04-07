import type { CSSProperties } from "react";

type StatusBadgeTone = "neutral" | "active" | "warning" | "danger" | "success";

const toneClassNames: Record<StatusBadgeTone, string> = {
  neutral: "studio-status-badge--neutral",
  active: "studio-status-badge--active",
  warning: "studio-status-badge--warning",
  danger: "studio-status-badge--danger",
  success: "studio-status-badge--success",
};

const toneStyleByClassName: Partial<Record<StatusBadgeTone, CSSProperties>> = {
  success: {
    background: "rgba(34, 197, 94, 0.18)",
    borderColor: "rgba(34, 197, 94, 0.42)",
  },
};

export type StatusBadgeProps = {
  label: string;
  tone?: StatusBadgeTone;
};

export default function StatusBadge({
  label,
  tone = "neutral",
}: Readonly<StatusBadgeProps>) {
  return (
    <span className={`studio-status-badge ${toneClassNames[tone]}`} style={toneStyleByClassName[tone]}>
      {label}
    </span>
  );
}
