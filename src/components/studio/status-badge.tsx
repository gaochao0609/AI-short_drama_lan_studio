type StatusBadgeTone = "neutral" | "active" | "warning" | "danger" | "success";

const toneClassNames: Record<StatusBadgeTone, string> = {
  neutral: "studio-status-badge--neutral",
  active: "studio-status-badge--active",
  warning: "studio-status-badge--warning",
  danger: "studio-status-badge--danger",
  success: "studio-status-badge--active",
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
    <span className={`studio-status-badge ${toneClassNames[tone]}`}>{label}</span>
  );
}
