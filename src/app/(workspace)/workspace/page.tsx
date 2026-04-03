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
      return "排队中";
    case "RUNNING":
      return "进行中";
    case "SUCCEEDED":
      return "已完成";
    case "FAILED":
      return "失败";
    case "CANCELED":
      return "已取消";
    default:
      return status;
  }
}

function mapProjectStatus(status: string) {
  switch (status.toUpperCase()) {
    case "ACTIVE":
      return "进行中";
    case "DRAFT":
      return "草稿";
    case "ARCHIVED":
      return "已归档";
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
      return "脚本已落地，建议推进分镜。";
    case "STORYBOARD":
      return "分镜已更新，建议生成关键画面。";
    case "IMAGE":
      return "画面已生成，建议进入视频制作。";
    case "VIDEO":
      return "视频阶段已启动，可回看项目详情。";
    default:
      return "项目刚建立，先进入脚本流程。";
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
      return `/projects/${projectId}/script`;
  }
}

export default async function WorkspaceDashboardPage() {
  const user = await requireUser();
  const [recentProjects, recentTasks, failedTaskCount] = await Promise.all([
    listRecentProjects(user.userId),
    listRecentTasks(user.userId),
    countFailedTasks(user.userId),
  ]);
  const latestTaskByProjectId = new Map(
    recentTasks.map((task) => [task.projectId, task] as const),
  );

  return (
    <div style={pageStyle}>
      <PageHero
        eyebrow="Workspace"
        title="今日创作控制台"
        description="从一个主入口进入项目创建，然后沿着 Script、Storyboard、Images、Videos 四段流程推进。这里优先呈现当前节奏、风险和下一步动作。"
        actions={
          <Link href="#create-project-entry" style={heroActionStyle}>
            前往创建入口
          </Link>
        }
        supportingContent={
          <>
            <p style={supportingLabelStyle}>最近动态</p>
            {recentTasks.length === 0 ? (
              <p style={supportingEmptyStyle}>今天还没有新的任务记录，先创建一个项目开始流程。</p>
            ) : (
              <ul style={supportingListStyle}>
                {recentTasks.slice(0, 3).map((task) => (
                  <li key={task.id} style={supportingItemStyle}>
                    <span style={supportingPrimaryStyle}>
                      {mapTaskType(task.type)} · {mapTaskStatus(task.status)}
                    </span>
                    <span style={supportingSecondaryStyle}>
                      {task.id} · 创建于 {formatDate(task.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p style={supportingFootnoteStyle}>
              失败任务 {failedTaskCount} 个，需要回看或重试的内容会优先出现在这里。
            </p>
          </>
        }
      />

      <section style={statsGridStyle} aria-label="工作区概览指标">
        <MetricCard
          label="最近项目"
          value={recentProjects.length}
          detail="仍按原服务返回最近项目列表。"
          emphasis={<span>当前优先：保持脚本到分镜的连续推进</span>}
        />
        <MetricCard
          label="最近任务"
          value={recentTasks.length}
          detail="汇总最近一次提交到各阶段的任务数量。"
          emphasis={
            recentTasks[0] ? (
              <span>
                最新阶段：{mapTaskType(recentTasks[0].type)} · {formatDate(recentTasks[0].createdAt)}
              </span>
            ) : null
          }
        />
        <MetricCard
          label="失败任务"
          value={failedTaskCount}
          detail="保留原失败计数逻辑，用于快速发现阻塞。"
          emphasis={<span>{failedTaskCount > 0 ? "需要尽快排查" : "当前没有阻塞"}</span>}
        />
      </section>

      <section style={contentGridStyle}>
        <div style={primaryColumnStyle}>
          <WorkflowRail
            title="Workflow Overview"
            items={[
              {
                label: "Script",
                detail: "整理项目方向、角色关系和剧情主轴。",
              },
              {
                label: "Storyboard",
                detail: "把脚本拆成可执行的镜头段落与节奏。",
              },
              {
                label: "Images",
                detail: "为关键镜头生成视觉基底与参考图。",
              },
              {
                label: "Videos",
                detail: "把关键帧推进为可交付的视频资产。",
              },
            ]}
          />

          <section style={projectsSectionStyle} aria-labelledby="recent-projects-heading">
            <div style={sectionHeaderStyle}>
              <div>
                <p style={sectionEyebrowStyle}>Projects</p>
                <h2 id="recent-projects-heading" style={sectionTitleStyle}>
                  最近项目推进面板
                </h2>
              </div>
              <p style={sectionSummaryStyle}>
                卡片会显示项目状态、最近更新时间、当前阶段和建议动作。
              </p>
            </div>
            {recentProjects.length === 0 ? (
              <p style={emptyStyle}>还没有项目，先从右侧入口创建第一个创作任务。</p>
            ) : (
              <div style={projectGridStyle}>
                {recentProjects.map((project) => {
                  const currentTask = latestTaskByProjectId.get(project.id);

                  return (
                    <ProjectCard
                      key={project.id}
                      title={project.title}
                      summary={project.idea?.trim() || "项目概念尚未填写，建议先补充一句话故事方向。"}
                      status={mapProjectStatus(project.status)}
                      statusTone={mapProjectStatusTone(project.status)}
                      updatedAtLabel={`更新于 ${formatDate(project.updatedAt)}`}
                      currentPhase={`当前阶段：${mapTaskType(currentTask?.type)}`}
                      nextActionLabel={mapNextActionLabel(currentTask?.type)}
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
                <p style={sectionEyebrowStyle}>Recent Tasks</p>
                <h2 style={sectionTitleStyle}>近期任务节奏</h2>
              </div>
            </div>
            {recentTasks.length === 0 ? (
              <p style={emptyStyle}>暂无任务记录。</p>
            ) : (
              <ul style={listStyle}>
                {recentTasks.map((task) => (
                  <li key={task.id} style={listItemStyle}>
                    <strong style={taskHeadingStyle}>{mapTaskType(task.type)}</strong>
                    <span style={metaStyle}>{task.id}</span>
                    <span style={metaStyle}>
                      {mapTaskStatus(task.status)} · 创建于 {formatDate(task.createdAt)}
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
  gridTemplateColumns: "minmax(0, 1.65fr) minmax(320px, 0.95fr)",
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
