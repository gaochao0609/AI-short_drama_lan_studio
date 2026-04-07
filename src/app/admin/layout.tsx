import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import AppShell from "@/components/studio/app-shell";
import { requireUser } from "@/lib/auth/guards";

const navItems = [
  { href: "/admin/users", label: "用户与权限" },
  { href: "/admin/providers", label: "模型提供方" },
  { href: "/admin/tasks", label: "任务监控" },
  { href: "/admin/storage", label: "存储管理" },
];

const nonHttpsWarning = "当前部署使用非 HTTPS，密码和 API Key 传输存在风险。";

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
      title="管理控制台"
      subtitle="统一管理账号权限、模型路由、任务状态与存储容量。"
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
