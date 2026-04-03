import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import AppShell from "@/components/studio/app-shell";
import { requireUser } from "@/lib/auth/guards";

const navItems = [
  { href: "/admin/users", label: "User access" },
  { href: "/admin/providers", label: "Provider stack" },
  { href: "/admin/tasks", label: "Task monitor" },
  { href: "/admin/storage", label: "Storage vault" },
];

const nonHttpsWarning =
  "当前为非 HTTPS 部署，密码和 API Key 传输存在风险";

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
    <AppShell
      title="Admin control"
      subtitle="Manage access, providers, task traffic, and storage from a shared control surface."
      navItems={navItems}
      banner={
        process.env.APP_URL?.startsWith("http://") ? (
          <p className="studio-notice">{nonHttpsWarning}</p>
        ) : null
      }
    >
      {children}
    </AppShell>
  );
}
