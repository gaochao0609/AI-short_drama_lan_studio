export type WorkflowRailItem = {
  label: string;
  detail?: string;
};

export type WorkflowRailProps = {
  title?: string;
  items: WorkflowRailItem[];
};

export default function WorkflowRail({
  title,
  items,
}: Readonly<WorkflowRailProps>) {
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
