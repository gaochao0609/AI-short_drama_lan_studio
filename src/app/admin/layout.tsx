import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";

const navItems = [
  { href: "/admin/users", label: "账号管理" },
  { href: "/admin/providers", label: "模型配置" },
  { href: "/admin/tasks", label: "任务监控" },
  { href: "/admin/storage", label: "存储管理" },
];

export default async function AdminLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  let user;

  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  if (user.forcePasswordChange) {
    redirect("/force-password");
  }

  if (user.role !== "ADMIN") {
    redirect("/");
  }

  return (
    <div style={shellStyle}>
      <aside style={sidebarStyle}>
        <p style={eyebrowStyle}>Admin</p>
        <h1 style={titleStyle}>后台管理</h1>
        <nav style={navStyle}>
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} style={navLinkStyle}>
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main style={mainStyle}>
        {process.env.APP_URL?.startsWith("http://") ? (
          <p style={warningBannerStyle}>
            当前为非 HTTPS 部署，密码和 API Key 传输存在风险
          </p>
        ) : null}
        {children}
      </main>
    </div>
  );
}

const shellStyle = {
  minHeight: "100vh",
  display: "grid",
  gridTemplateColumns: "260px minmax(0, 1fr)",
} satisfies CSSProperties;

const sidebarStyle = {
  padding: "28px 20px",
  borderRight: "1px solid rgba(31, 27, 22, 0.12)",
  background: "rgba(255, 250, 243, 0.86)",
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
} satisfies React.CSSProperties;

const warningBannerStyle = {
  margin: "0 0 20px",
  padding: "14px 16px",
  borderRadius: "16px",
  background: "rgba(190, 69, 22, 0.12)",
  color: "#7b2d0b",
  border: "1px solid rgba(190, 69, 22, 0.22)",
} satisfies React.CSSProperties;
