import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import AppShell from "@/components/studio/app-shell";
import WorkflowRail from "@/components/studio/workflow-rail";
import { AuthGuardError, requireUser } from "@/lib/auth/guards";

const navItems = [{ href: "/workspace", label: "Workspace overview" }];

const workflowItems = [
  { label: "Script", detail: "Shape the story and scene beats." },
  { label: "Storyboard", detail: "Translate the script into visual boards." },
  { label: "Images", detail: "Generate keyframes and art direction." },
  { label: "Videos", detail: "Assemble final motion outputs." },
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
      title="Creative workspace"
      subtitle="Build scripts, frames, imagery, and final cuts from one shared studio shell."
      navItems={navItems}
      sidebarAddon={<WorkflowRail title="Studio pipeline" items={workflowItems} />}
    >
      {children}
    </AppShell>
  );
}
