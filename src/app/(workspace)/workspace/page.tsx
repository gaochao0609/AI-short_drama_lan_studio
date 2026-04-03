import type { CSSProperties } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/guards";
import MetricCard from "@/components/studio/metric-card";
import PageHero from "@/components/studio/page-hero";
import ProjectCard from "@/components/studio/project-card";
import WorkflowRail from "@/components/studio/workflow-rail";
import { listRecentProjects } from "@/lib/services/projects";
import { countFailedTasks, listRecentTasks } from "@/lib/services/tasks";
import CreateProjectForm from "./create-project-form";

const copy = {
  heroTitle: "\u4eca\u65e5\u521b\u4f5c\u63a7\u5236\u53f0",
  heroDescription:
    "\u4ece\u4e00\u4e2a\u4e3b\u5165\u53e3\u8fdb\u5165\u9879\u76ee\u521b\u5efa\uff0c\u7136\u540e\u6cbf\u7740 Script\u3001Storyboard\u3001Images\u3001Videos \u56db\u6bb5\u6d41\u7a0b\u63a8\u8fdb\u3002\u8fd9\u91cc\u4f18\u5148\u5448\u73b0\u5f53\u524d\u8282\u594f\u3001\u98ce\u9669\u548c\u4e0b\u4e00\u6b65\u52a8\u4f5c\u3002",
  heroAction: "\u524d\u5f80\u521b\u5efa\u5165\u53e3",
  recentActivity: "\u6700\u8fd1\u52a8\u6001",
  noRecentTasks:
    "\u4eca\u5929\u8fd8\u6ca1\u6709\u65b0\u7684\u4efb\u52a1\u8bb0\u5f55\uff0c\u5148\u521b\u5efa\u4e00\u4e2a\u9879\u76ee\u5f00\u59cb\u6d41\u7a0b\u3002",
  createdAtPrefix: "\u521b\u5efa\u4e8e ",
  failedTasksFootnotePrefix: "\u5931\u8d25\u4efb\u52a1 ",
  failedTasksFootnoteSuffix:
    " \u4e2a\uff0c\u9700\u8981\u56de\u770b\u6216\u91cd\u8bd5\u7684\u5185\u5bb9\u4f1a\u4f18\u5148\u51fa\u73b0\u5728\u8fd9\u91cc\u3002",
  metricsAria: "\u5de5\u4f5c\u533a\u6982\u89c8\u6307\u6807",
  recentProjects: "\u6700\u8fd1\u9879\u76ee",
  recentTasks: "\u6700\u8fd1\u4efb\u52a1",
  failedTasks: "\u5931\u8d25\u4efb\u52a1",
  recentProjectsDetail: "\u4ecd\u6309\u539f\u670d\u52a1\u8fd4\u56de\u6700\u8fd1\u9879\u76ee\u5217\u8868\u3002",
  recentTasksDetail: "\u6c47\u603b\u6700\u8fd1\u4e00\u6b21\u63d0\u4ea4\u5230\u5404\u9636\u6bb5\u7684\u4efb\u52a1\u6570\u91cf\u3002",
  failedTasksDetail: "\u4fdd\u7559\u539f\u5931\u8d25\u8ba1\u6570\u903b\u8f91\uff0c\u7528\u4e8e\u5feb\u901f\u53d1\u73b0\u963b\u585e\u3002",
  keepMomentum: "\u5f53\u524d\u4f18\u5148\uff1a\u4fdd\u6301\u811a\u672c\u5230\u5206\u955c\u7684\u8fde\u7eed\u63a8\u8fdb",
  latestStagePrefix: "\u6700\u65b0\u9636\u6bb5\uff1a",
  investigateSoon: "\u9700\u8981\u5c3d\u5feb\u6392\u67e5",
  noBlockers: "\u5f53\u524d\u6ca1\u6709\u963b\u585e",
  workflowTitle: "Workflow Overview",
  workflowScriptDetail: "\u6574\u7406\u9879\u76ee\u65b9\u5411\u3001\u89d2\u8272\u5173\u7cfb\u548c\u5267\u60c5\u4e3b\u8f74\u3002",
  workflowStoryboardDetail: "\u628a\u811a\u672c\u62c6\u6210\u53ef\u6267\u884c\u7684\u955c\u5934\u6bb5\u843d\u4e0e\u8282\u594f\u3002",
  workflowImagesDetail: "\u4e3a\u5173\u952e\u955c\u5934\u751f\u6210\u89c6\u89c9\u57fa\u5e95\u4e0e\u53c2\u8003\u56fe\u3002",
  workflowVideosDetail: "\u628a\u5173\u952e\u5e27\u63a8\u8fdb\u4e3a\u53ef\u4ea4\u4ed8\u7684\u89c6\u9891\u8d44\u4ea7\u3002",
  projectsEyebrow: "Projects",
  projectsHeading: "\u6700\u8fd1\u9879\u76ee\u63a8\u8fdb\u9762\u677f",
  projectsSummary:
    "\u5361\u7247\u4f1a\u663e\u793a\u9879\u76ee\u72b6\u6001\u3001\u6700\u8fd1\u66f4\u65b0\u65f6\u95f4\u3001\u5f53\u524d\u9636\u6bb5\u548c\u5efa\u8bae\u52a8\u4f5c\u3002",
  noProjects:
    "\u8fd8\u6ca1\u6709\u9879\u76ee\uff0c\u5148\u4ece\u53f3\u4fa7\u5165\u53e3\u521b\u5efa\u7b2c\u4e00\u4e2a\u521b\u4f5c\u4efb\u52a1\u3002",
  noIdea:
    "\u9879\u76ee\u6982\u5ff5\u5c1a\u672a\u586b\u5199\uff0c\u5efa\u8bae\u5148\u8865\u5145\u4e00\u53e5\u8bdd\u6545\u4e8b\u65b9\u5411\u3002",
  updatedAtPrefix: "\u66f4\u65b0\u4e8e ",
  currentPhasePrefix: "\u5f53\u524d\u9636\u6bb5\uff1a",
  noRecentTaskPhase: "\u6682\u65e0\u6700\u8fd1\u4efb\u52a1",
  recentTasksEyebrow: "Recent Tasks",
  recentTasksHeading: "\u8fd1\u671f\u4efb\u52a1\u8282\u594f",
  noTaskRecords: "\u6682\u65e0\u4efb\u52a1\u8bb0\u5f55\u3002",
  queued: "\u6392\u961f\u4e2d",
  running: "\u8fdb\u884c\u4e2d",
  succeeded: "\u5df2\u5b8c\u6210",
  failed: "\u5931\u8d25",
  canceled: "\u5df2\u53d6\u6d88",
  active: "\u8fdb\u884c\u4e2d",
  draft: "\u8349\u7a3f",
  archived: "\u5df2\u5f52\u6863",
  scriptNext: "\u811a\u672c\u5df2\u843d\u5730\uff0c\u5efa\u8bae\u63a8\u8fdb\u5206\u955c\u3002",
  storyboardNext: "\u5206\u955c\u5df2\u66f4\u65b0\uff0c\u5efa\u8bae\u751f\u6210\u5173\u952e\u753b\u9762\u3002",
  imageNext: "\u753b\u9762\u5df2\u751f\u6210\uff0c\u5efa\u8bae\u8fdb\u5165\u89c6\u9891\u5236\u4f5c\u3002",
  videoNext: "\u89c6\u9891\u9636\u6bb5\u5df2\u542f\u52a8\uff0c\u53ef\u56de\u770b\u9879\u76ee\u8be6\u60c5\u3002",
  noRecentTaskNext:
    "\u6700\u8fd1\u4efb\u52a1\u4e0d\u5728\u5f53\u524d\u5217\u8868\u4e2d\uff0c\u5148\u67e5\u770b\u9879\u76ee\u8be6\u60c5\u786e\u8ba4\u8fdb\u5ea6\u3002",
  openStoryboardFlow: "\u8fdb\u5165\u5206\u955c\u6d41\u7a0b",
  openImagesFlow: "\u8fdb\u5165\u753b\u9762\u6d41\u7a0b",
  openVideosFlow: "\u8fdb\u5165\u89c6\u9891\u6d41\u7a0b",
  viewProjectDetail: "\u67e5\u770b\u9879\u76ee\u8be6\u60c5",
} as const;

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function mapTaskType(type?: string) {
  switch (type) {
    case "SCRIPT_FINALIZE":
      return "Script";
    case "STORYBOARD":
      return "Storyboard";
    case "IMAGE":
      return "Images";
    case "VIDEO":
      return "Videos";
    default:
      return "Script";
  }
}

function mapTaskStatus(status: string) {
  switch (status) {
    case "QUEUED":
      return copy.queued;
    case "RUNNING":
      return copy.running;
    case "SUCCEEDED":
      return copy.succeeded;
    case "FAILED":
      return copy.failed;
    case "CANCELED":
      return copy.canceled;
    default:
      return status;
  }
}

function mapProjectStatus(status: string) {
  switch (status.toUpperCase()) {
    case "ACTIVE":
      return copy.active;
    case "DRAFT":
      return copy.draft;
    case "ARCHIVED":
      return copy.archived;
    default:
      return status;
  }
}

function mapProjectStatusTone(
  status: string,
): "neutral" | "active" | "warning" | "danger" {
  switch (status.toUpperCase()) {
    case "ACTIVE":
      return "active";
    case "ARCHIVED":
      return "neutral";
    case "FAILED":
      return "danger";
    default:
      return "warning";
  }
}

function mapNextActionLabel(type?: string) {
  switch (type) {
    case "SCRIPT_FINALIZE":
      return copy.scriptNext;
    case "STORYBOARD":
      return copy.storyboardNext;
    case "IMAGE":
      return copy.imageNext;
    case "VIDEO":
      return copy.videoNext;
    default:
      return copy.noRecentTaskNext;
    }
}

function mapNextActionHref(projectId: string, type?: string) {
  switch (type) {
    case "SCRIPT_FINALIZE":
      return `/projects/${projectId}/storyboard`;
    case "STORYBOARD":
      return `/projects/${projectId}/images`;
    case "IMAGE":
      return `/projects/${projectId}/videos`;
    case "VIDEO":
      return `/projects/${projectId}`;
    default:
      return `/projects/${projectId}`;
  }
}

function mapNextActionCtaLabel(type?: string) {
  switch (type) {
    case "SCRIPT_FINALIZE":
      return copy.openStoryboardFlow;
    case "STORYBOARD":
      return copy.openImagesFlow;
    case "IMAGE":
      return copy.openVideosFlow;
    case "VIDEO":
      return copy.viewProjectDetail;
    default:
      return copy.viewProjectDetail;
  }
}

function getLatestTaskByProjectId(
  recentTasks: Awaited<ReturnType<typeof listRecentTasks>>,
) {
  const latestTaskByProjectId = new Map<string, (typeof recentTasks)[number]>();

  for (const task of recentTasks) {
    const currentTask = latestTaskByProjectId.get(task.projectId);

    if (!currentTask || task.createdAt > currentTask.createdAt) {
      latestTaskByProjectId.set(task.projectId, task);
    }
  }

  return latestTaskByProjectId;
}

export default async function WorkspaceDashboardPage() {
  const user = await requireUser();
  const [recentProjects, recentTasks, failedTaskCount] = await Promise.all([
    listRecentProjects(user.userId),
    listRecentTasks(user.userId),
    countFailedTasks(user.userId),
  ]);
  const latestTaskByProjectId = getLatestTaskByProjectId(recentTasks);

  return (
    <div style={pageStyle}>
      <PageHero
        eyebrow="Workspace"
        title={copy.heroTitle}
        description={copy.heroDescription}
        actions={
          <Link href="#create-project-entry" style={heroActionStyle}>
            {copy.heroAction}
          </Link>
        }
        supportingContent={
          <>
            <p style={supportingLabelStyle}>{copy.recentActivity}</p>
            {recentTasks.length === 0 ? (
              <p style={supportingEmptyStyle}>{copy.noRecentTasks}</p>
            ) : (
              <ul style={supportingListStyle}>
                {recentTasks.slice(0, 3).map((task) => (
                  <li key={task.id} style={supportingItemStyle}>
                    <span style={supportingPrimaryStyle}>
                      {mapTaskType(task.type)} · {mapTaskStatus(task.status)}
                    </span>
                    <span style={supportingSecondaryStyle}>
                      {task.id} · {copy.createdAtPrefix}
                      {formatDate(task.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p style={supportingFootnoteStyle}>
              {copy.failedTasksFootnotePrefix}
              {failedTaskCount}
              {copy.failedTasksFootnoteSuffix}
            </p>
          </>
        }
      />

      <section style={statsGridStyle} aria-label={copy.metricsAria}>
        <MetricCard
          label={copy.recentProjects}
          value={recentProjects.length}
          detail={copy.recentProjectsDetail}
          emphasis={<span>{copy.keepMomentum}</span>}
        />
        <MetricCard
          label={copy.recentTasks}
          value={recentTasks.length}
          detail={copy.recentTasksDetail}
          emphasis={
            recentTasks[0] ? (
              <span>
                {copy.latestStagePrefix}
                {mapTaskType(recentTasks[0].type)} · {formatDate(recentTasks[0].createdAt)}
              </span>
            ) : null
          }
        />
        <MetricCard
          label={copy.failedTasks}
          value={failedTaskCount}
          detail={copy.failedTasksDetail}
          emphasis={<span>{failedTaskCount > 0 ? copy.investigateSoon : copy.noBlockers}</span>}
        />
      </section>

      <section className="workspace-dashboard__content-grid" style={contentGridStyle}>
        <div style={primaryColumnStyle}>
          <WorkflowRail
            title={copy.workflowTitle}
            items={[
              {
                label: "Script",
                detail: copy.workflowScriptDetail,
              },
              {
                label: "Storyboard",
                detail: copy.workflowStoryboardDetail,
              },
              {
                label: "Images",
                detail: copy.workflowImagesDetail,
              },
              {
                label: "Videos",
                detail: copy.workflowVideosDetail,
              },
            ]}
          />

          <section style={projectsSectionStyle} aria-labelledby="recent-projects-heading">
            <div style={sectionHeaderStyle}>
              <div>
                <p style={sectionEyebrowStyle}>{copy.projectsEyebrow}</p>
                <h2 id="recent-projects-heading" style={sectionTitleStyle}>
                  {copy.projectsHeading}
                </h2>
              </div>
              <p style={sectionSummaryStyle}>{copy.projectsSummary}</p>
            </div>
            {recentProjects.length === 0 ? (
              <p style={emptyStyle}>{copy.noProjects}</p>
            ) : (
              <div style={projectGridStyle}>
                {recentProjects.map((project) => {
                  const currentTask = latestTaskByProjectId.get(project.id);
                  const currentPhase = currentTask
                    ? `${copy.currentPhasePrefix}${mapTaskType(currentTask.type)}`
                    : `${copy.currentPhasePrefix}${copy.noRecentTaskPhase}`;

                  return (
                    <ProjectCard
                      key={project.id}
                      projectId={project.id}
                      title={project.title}
                      summary={project.idea?.trim() || copy.noIdea}
                      status={mapProjectStatus(project.status)}
                      statusTone={mapProjectStatusTone(project.status)}
                      updatedAtLabel={`${copy.updatedAtPrefix}${formatDate(project.updatedAt)}`}
                      currentPhase={currentPhase}
                      nextActionLabel={mapNextActionLabel(currentTask?.type)}
                      nextActionCtaLabel={mapNextActionCtaLabel(currentTask?.type)}
                      nextActionHref={mapNextActionHref(project.id, currentTask?.type)}
                    />
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div style={secondaryColumnStyle}>
          <CreateProjectForm />
          <article style={panelStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <p style={sectionEyebrowStyle}>{copy.recentTasksEyebrow}</p>
                <h2 style={sectionTitleStyle}>{copy.recentTasksHeading}</h2>
              </div>
            </div>
            {recentTasks.length === 0 ? (
              <p style={emptyStyle}>{copy.noTaskRecords}</p>
            ) : (
              <ul style={listStyle}>
                {recentTasks.map((task) => (
                  <li key={task.id} style={listItemStyle}>
                    <strong style={taskHeadingStyle}>{mapTaskType(task.type)}</strong>
                    <span style={metaStyle}>{task.id}</span>
                    <span style={metaStyle}>
                      {mapTaskStatus(task.status)} · {copy.createdAtPrefix}
                      {formatDate(task.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </div>
      </section>
    </div>
  );
}

const pageStyle = {
  display: "grid",
  gap: "24px",
} satisfies CSSProperties;

const heroActionStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "46px",
  padding: "0 20px",
  borderRadius: "999px",
  background: "linear-gradient(135deg, #ca8a04, #f59e0b)",
  color: "#0f0f23",
  textDecoration: "none",
  fontWeight: 700,
  boxShadow: "0 16px 36px rgba(202, 138, 4, 0.24)",
} satisfies CSSProperties;

const supportingLabelStyle = {
  margin: 0,
  fontSize: "0.78rem",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "#ca8a04",
} satisfies CSSProperties;

const supportingListStyle = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "grid",
  gap: "10px",
} satisfies CSSProperties;

const supportingItemStyle = {
  display: "grid",
  gap: "4px",
  paddingBottom: "10px",
  borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
} satisfies CSSProperties;

const supportingPrimaryStyle = {
  color: "#f8fafc",
  fontWeight: 600,
} satisfies CSSProperties;

const supportingSecondaryStyle = {
  color: "#b8c0d4",
  fontSize: "0.92rem",
} satisfies CSSProperties;

const supportingEmptyStyle = {
  margin: 0,
  color: "#b8c0d4",
  lineHeight: 1.6,
} satisfies CSSProperties;

const supportingFootnoteStyle = {
  margin: 0,
  color: "#b8c0d4",
  lineHeight: 1.6,
} satisfies CSSProperties;

const statsGridStyle = {
  display: "grid",
  gap: "16px",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
} satisfies CSSProperties;

const contentGridStyle = {
  display: "grid",
  gap: "20px",
  alignItems: "start",
} satisfies CSSProperties;

const primaryColumnStyle = {
  display: "grid",
  gap: "20px",
} satisfies CSSProperties;

const secondaryColumnStyle = {
  display: "grid",
  gap: "20px",
} satisfies CSSProperties;

const projectsSectionStyle = {
  display: "grid",
  gap: "18px",
} satisfies CSSProperties;

const projectGridStyle = {
  display: "grid",
  gap: "16px",
  gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
} satisfies CSSProperties;

const panelStyle = {
  display: "grid",
  gap: "18px",
  padding: "22px",
  borderRadius: "24px",
  border: "1px solid rgba(129, 140, 248, 0.24)",
  background: "rgba(22, 24, 39, 0.88)",
  boxShadow: "0 28px 60px rgba(10, 12, 24, 0.18)",
} satisfies CSSProperties;

const sectionHeaderStyle = {
  display: "grid",
  gap: "10px",
} satisfies CSSProperties;

const sectionEyebrowStyle = {
  margin: 0,
  color: "#ca8a04",
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  fontSize: "0.74rem",
} satisfies CSSProperties;

const sectionTitleStyle = {
  margin: 0,
  fontSize: "1.4rem",
} satisfies CSSProperties;

const sectionSummaryStyle = {
  margin: 0,
  color: "#b8c0d4",
  lineHeight: 1.6,
} satisfies CSSProperties;

const listStyle = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "grid",
  gap: "12px",
} satisfies CSSProperties;

const listItemStyle = {
  display: "grid",
  gap: "4px",
  paddingBottom: "12px",
  borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
} satisfies CSSProperties;

const taskHeadingStyle = {
  color: "#f8fafc",
} satisfies CSSProperties;

const metaStyle = {
  color: "#b8c0d4",
  fontSize: "0.92rem",
} satisfies CSSProperties;

const emptyStyle = {
  margin: 0,
  color: "#b8c0d4",
  lineHeight: 1.6,
} satisfies CSSProperties;
