import type { ReactNode } from "react";

export type PageHeroProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
};

export default function PageHero({
  eyebrow,
  title,
  description,
  actions,
}: Readonly<PageHeroProps>) {
  return (
    <section className="studio-page-hero">
      <div className="studio-page-hero__content">
        {eyebrow ? <p className="studio-page-hero__eyebrow">{eyebrow}</p> : null}
        <h1 className="studio-page-hero__title">{title}</h1>
        {description ? (
          <p className="studio-page-hero__description">{description}</p>
        ) : null}
        {actions ? <div className="studio-page-hero__actions">{actions}</div> : null}
      </div>
    </section>
  );
}
