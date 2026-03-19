import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";

const navItems = [
  { href: "/workspace", label: "仪表盘" },
  { href: "/workspace/projects", label: "项目" },
  { href: "/workspace/tasks", label: "任务" },
];

export default async function WorkspaceLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  let user;

  try {
    user = await requireUser();
  } catch {
    redirect("/login");
    return null;
  }

  if (user.forcePasswordChange) {
    redirect("/force-password");
    return null;
  }

  return (
    <div style={shellStyle}>
      <aside style={sidebarStyle}>
        <p style={eyebrowStyle}>Workspace</p>
        <h1 style={titleStyle}>Lan Studio</h1>
        <nav style={navStyle}>
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} style={navLinkStyle}>
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main style={mainStyle}>{children}</main>
    </div>
  );
}

const shellStyle = {
  minHeight: "100vh",
  display: "grid",
  gridTemplateColumns: "240px minmax(0, 1fr)",
} satisfies CSSProperties;

const sidebarStyle = {
  padding: "28px 20px",
  borderRight: "1px solid rgba(31, 27, 22, 0.12)",
  background: "rgba(255, 250, 243, 0.88)",
} satisfies CSSProperties;

const eyebrowStyle = {
  margin: 0,
  color: "#8c5f2d",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  fontSize: "0.8rem",
} satisfies CSSProperties;

const titleStyle = {
  margin: "12px 0 0",
  fontSize: "1.8rem",
} satisfies CSSProperties;

const navStyle = {
  display: "grid",
  gap: "10px",
  marginTop: "28px",
} satisfies CSSProperties;

const navLinkStyle = {
  padding: "12px 14px",
  borderRadius: "14px",
  textDecoration: "none",
  background: "rgba(140, 95, 45, 0.08)",
} satisfies CSSProperties;

const mainStyle = {
  padding: "28px",
} satisfies CSSProperties;
