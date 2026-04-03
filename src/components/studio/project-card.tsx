import StatusBadge from "@/components/studio/status-badge";

export type ProjectCardProps = {
  title: string;
  summary: string;
  status: string;
  updatedAtLabel: string;
  nextStep?: string;
};

export default function ProjectCard({
  title,
  summary,
  status,
  updatedAtLabel,
  nextStep,
}: Readonly<ProjectCardProps>) {
  return (
    <article className="studio-project-card">
      <div className="studio-project-card__header">
        <h2 className="studio-project-card__title">{title}</h2>
        <StatusBadge label={status} tone="active" />
      </div>
      <p className="studio-project-card__summary">{summary}</p>
      <div className="studio-project-card__meta">
        <span>{updatedAtLabel}</span>
        {nextStep ? <span>{nextStep}</span> : null}
      </div>
    </article>
  );
}
