import type { ReactNode } from "react";

export type PageHeroProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  supportingContent?: ReactNode;
};

export default function PageHero({
  eyebrow,
  title,
  description,
  actions,
  supportingContent,
}: Readonly<PageHeroProps>) {
  return (
    <section className="studio-page-hero" style={heroStyle}>
      <div className="studio-page-hero__content">
        {eyebrow ? <p className="studio-page-hero__eyebrow">{eyebrow}</p> : null}
        <h1 className="studio-page-hero__title">{title}</h1>
        {description ? (
          <p className="studio-page-hero__description">{description}</p>
        ) : null}
        {actions ? <div className="studio-page-hero__actions">{actions}</div> : null}
      </div>
      {supportingContent ? (
        <div style={supportingContentStyle}>{supportingContent}</div>
      ) : null}
    </section>
  );
}

const heroStyle = {
  display: "grid",
  gap: "24px",
  gridTemplateColumns: "minmax(0, 1.7fr) minmax(280px, 1fr)",
  alignItems: "stretch",
  background:
    "linear-gradient(135deg, rgba(109, 94, 252, 0.24), rgba(22, 24, 39, 0.88) 55%, rgba(202, 138, 4, 0.18))",
} as const;

const supportingContentStyle = {
  display: "grid",
  gap: "12px",
  alignContent: "start",
  padding: "18px",
  borderRadius: "20px",
  border: "1px solid rgba(255, 255, 255, 0.1)",
  background: "rgba(9, 11, 24, 0.36)",
} as const;
