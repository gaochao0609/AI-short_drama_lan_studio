import type { ReactNode } from "react";
import Link from "next/link";

export type AppShellNavItem = {
  href: string;
  label: string;
};

export type AppShellProps = {
  eyebrow?: string;
  title: string;
  subtitle: string;
  navItems: AppShellNavItem[];
  sidebarAddon?: ReactNode;
  children: ReactNode;
  banner?: ReactNode;
};

export default function AppShell({
  eyebrow = "Studio shell",
  title,
  subtitle,
  navItems,
  sidebarAddon,
  children,
  banner,
}: Readonly<AppShellProps>) {
  return (
    <div className="studio-shell">
      <aside className="studio-shell__sidebar">
        <div className="studio-shell__brand-block">
          <p className="studio-shell__eyebrow">{eyebrow}</p>
          <h1 className="studio-shell__brand">Lan Studio</h1>
          <p className="studio-shell__title">{title}</p>
          <p className="studio-shell__subtitle">{subtitle}</p>
        </div>

        <nav className="studio-shell__nav" aria-label={`${title} navigation`}>
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className="studio-shell__nav-link">
              {item.label}
            </Link>
          ))}
        </nav>

        {sidebarAddon ? (
          <div className="studio-shell__sidebar-addon">{sidebarAddon}</div>
        ) : null}
      </aside>

      <main className="studio-shell__main">
        {banner ? <div className="studio-shell__banner">{banner}</div> : null}
        {children}
      </main>
    </div>
  );
}
