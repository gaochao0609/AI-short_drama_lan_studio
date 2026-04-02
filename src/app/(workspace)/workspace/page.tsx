import type { CSSProperties } from "react";
import { requireUser } from "@/lib/auth/guards";
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

export default async function WorkspaceDashboardPage() {
  const user = await requireUser();
  const [recentProjects, recentTasks, failedTaskCount] = await Promise.all([
    listRecentProjects(user.userId),
    listRecentTasks(user.userId),
    countFailedTasks(user.userId),
  ]);

  return (
    <div style={pageStyle}>
      <section style={heroStyle}>
        <p style={sectionEyebrowStyle}>Workspace</p>
        <h2 style={heroTitleStyle}>最近活动</h2>
        <p style={heroTextStyle}>
          先创建项目，再进入脚本、分镜、图片和视频四条工作流。这里同时保留最近项目和最近任务概览。
        </p>
      </section>

      <section style={statsGridStyle}>
        <article style={statCardStyle}>
          <p style={statLabelStyle}>最近项目</p>
          <strong style={statValueStyle}>{recentProjects.length}</strong>
        </article>
        <article style={statCardStyle}>
          <p style={statLabelStyle}>最近任务</p>
          <strong style={statValueStyle}>{recentTasks.length}</strong>
        </article>
        <article style={statCardStyle}>
          <p style={statLabelStyle}>失败任务数</p>
          <strong style={statValueStyle}>{failedTaskCount}</strong>
        </article>
      </section>

      <section style={contentGridStyle}>
        <CreateProjectForm />

        <article style={panelStyle}>
          <h3 style={panelTitleStyle}>最近项目</h3>
          {recentProjects.length === 0 ? (
            <p style={emptyStyle}>暂无项目。</p>
          ) : (
            <ul style={listStyle}>
              {recentProjects.map((project) => (
                <li key={project.id} style={listItemStyle}>
                  <strong>{project.title}</strong>
                  <span style={metaStyle}>
                    {project.status} · 更新于 {formatDate(project.updatedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article style={panelStyle}>
          <h3 style={panelTitleStyle}>最近任务</h3>
          {recentTasks.length === 0 ? (
            <p style={emptyStyle}>暂无任务。</p>
          ) : (
            <ul style={listStyle}>
              {recentTasks.map((task) => (
                <li key={task.id} style={listItemStyle}>
                  <strong>{task.id}</strong>
                  <span style={metaStyle}>
                    {task.type} · {task.status} · 创建于 {formatDate(task.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>
    </div>
  );
}

const pageStyle = {
  display: "grid",
  gap: "24px",
} satisfies CSSProperties;

const heroStyle = {
  padding: "28px",
  borderRadius: "24px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
  background: "rgba(255, 250, 243, 0.9)",
} satisfies CSSProperties;

const sectionEyebrowStyle = {
  margin: 0,
  color: "#8c5f2d",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  fontSize: "0.8rem",
} satisfies CSSProperties;

const heroTitleStyle = {
  margin: "12px 0 0",
  fontSize: "2rem",
} satisfies CSSProperties;

const heroTextStyle = {
  margin: "12px 0 0",
  color: "#665d52",
  lineHeight: 1.7,
} satisfies CSSProperties;

const statsGridStyle = {
  display: "grid",
  gap: "16px",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
} satisfies CSSProperties;

const statCardStyle = {
  padding: "20px",
  borderRadius: "20px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
  background: "rgba(255, 250, 243, 0.82)",
} satisfies CSSProperties;

const statLabelStyle = {
  margin: 0,
  color: "#665d52",
} satisfies CSSProperties;

const statValueStyle = {
  display: "block",
  marginTop: "12px",
  fontSize: "2rem",
} satisfies CSSProperties;

const contentGridStyle = {
  display: "grid",
  gap: "16px",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
} satisfies CSSProperties;

const panelStyle = {
  padding: "24px",
  borderRadius: "24px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
  background: "rgba(255, 250, 243, 0.82)",
} satisfies CSSProperties;

const panelTitleStyle = {
  margin: 0,
  fontSize: "1.2rem",
} satisfies CSSProperties;

const listStyle = {
  listStyle: "none",
  margin: "18px 0 0",
  padding: 0,
  display: "grid",
  gap: "12px",
} satisfies CSSProperties;

const listItemStyle = {
  display: "grid",
  gap: "4px",
  paddingBottom: "12px",
  borderBottom: "1px solid rgba(31, 27, 22, 0.08)",
} satisfies CSSProperties;

const metaStyle = {
  color: "#665d52",
  fontSize: "0.92rem",
} satisfies CSSProperties;

const emptyStyle = {
  margin: "18px 0 0",
  color: "#665d52",
} satisfies CSSProperties;
