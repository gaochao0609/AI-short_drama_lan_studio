import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import AppShell from "@/components/studio/app-shell";
import WorkflowRail from "@/components/studio/workflow-rail";
import { AuthGuardError, requireUser } from "@/lib/auth/guards";

const navItems = [{ href: "/workspace", label: "工作台总览" }];

const workflowItems = [
  { label: "脚本", detail: "梳理故事方向与场景节奏。" },
  { label: "分镜", detail: "把剧本拆解成可执行的画面方案。" },
  { label: "图片", detail: "生成关键帧与整体美术方向。" },
  { label: "视频", detail: "整合镜头素材并推进最终成片。" },
];

export default async function WorkspaceLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  let user;

  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof AuthGuardError && error.status === 401) {
      redirect("/login");
      return null;
    }

    throw error;
  }

  if (user.forcePasswordChange) {
    redirect("/force-password");
    return null;
  }

  return (
    <AppShell
      eyebrow="创作中枢"
      title="创作工作台"
      subtitle="在同一个工作台内推进剧本、分镜、出图和成片流程。"
      navItems={navItems}
      sidebarAddon={<WorkflowRail title="创作流程" items={workflowItems} />}
    >
      {children}
    </AppShell>
  );
}
