import type { CSSProperties } from "react";
import Link from "next/link";
import PageHero from "@/components/studio/page-hero";
import StatusBadge from "@/components/studio/status-badge";
import type { StatusBadgeProps } from "@/components/studio/status-badge";
import WorkflowRail from "@/components/studio/workflow-rail";
import { requireUser } from "@/lib/auth/guards";
import { getProjectDetail } from "@/lib/services/projects";

type PageProps = {
  params: Promise<{ projectId: string }> | { projectId: string };
};

const copy = {
  eyebrow: "制作台",
  noIdea: "这个项目还没有写下核心概念，建议先补一句故事方向，再继续推进流程。",
  backToWorkspace: "返回工作台",
  continueScriptWorkflow: "继续脚本流程",
  heroStatusLabel: "项目状态",
  heroUpdatedLabel: "最近更新",
  heroFocusLabel: "当前焦点",
  noRecentTask: "还没有任务记录，先从脚本阶段开始建立项目骨架。",
  latestTaskPrefix: "最近任务创建于 ",
  workflowTitle: "流程控制",
  workflowScriptEmpty: "还没有脚本版本，先把故事方向整理成可迭代的剧本。",
  workflowStoryboardEmpty: "等待脚本定稿后拆分镜头与节奏。",
  workflowImagesEmpty: "等待分镜产出后生成关键画面。",
  workflowVideosEmpty: "等待画面确认后推进视频制作。",
  workflowScriptDetailPrefix: "版本 ",
  workflowStoryboardDetailSuffix: " 个镜头",
  workflowImageLink: "进入图片流程",
  workflowVideoLink: "进入视频流程",
  workflowStoryboardLink: "进入分镜流程",
  workflowScriptLink: "进入脚本流程",
  badgeReady: "下一步",
  badgeWaiting: "待开始",
  badgeDone: "已产出",
  scriptsHeading: "脚本记录",
  scriptsDescription: "保留每次脚本定稿内容，便于继续扩写、回看和比对。",
  scriptsEmpty: "还没有脚本版本，先从脚本流程开始。",
  scriptVersionPrefix: "Version ",
  noScriptBody: "当前版本没有保存脚本正文。",
  storyboardsHeading: "分镜记录",
  storyboardsDescription: "沿用既有分镜历史数据，继续保留镜头数量与关联脚本信息。",
  storyboardsEmpty: "还没有分镜记录，完成脚本后即可生成。",
  storyboardFramesSuffix: " 个镜头",
  storyboardScriptPrefix: "关联脚本 ",
  imagesHeading: "图片资产",
  imagesDescription: "更大的预览卡片保留下载入口，方便快速判断是否可直接进入视频阶段。",
  imagesEmpty: "还没有图片资产，先完成分镜并生成关键画面。",
  videosHeading: "视频资产",
  videosDescription: "视频预览与下载链接保持不变，只调整成更清晰的浏览布局。",
  videosEmpty: "还没有视频资产，确认图片后即可进入视频制作。",
  taskHistoryHeading: "任务历史",
  taskHistoryDescription: "任务历史数据保持原样展示，用于回看阶段状态和处理时间。",
  taskHistoryEmpty: "还没有任务记录。",
  assetOverviewHeading: "资产概览",
  assetOverviewDescription: "统一查看项目资产数量、当前默认绑定，并进入资产中心集中管理。",
  assetOverviewLink: "进入资产中心",
  assetOverviewScriptCount: "脚本资产",
  assetOverviewImageCount: "图片资产",
  assetOverviewVideoCount: "视频资产",
  currentStoryboardBinding: "当前默认分镜剧本",
  currentImageBindings: "图片默认参考",
  currentVideoBindings: "视频默认参考",
  noDefaultBinding: "还没有设置默认绑定",
  itemsSuffix: " 项",
  taskCreatedPrefix: "创建于 ",
  taskFinishedPrefix: "完成于 ",
  taskErrorPrefix: "错误：",
  assetDownloadPrefix: "下载 ",
  assetPreviewUnavailable: "预览不可用",
  active: "进行中",
  draft: "草稿",
  archived: "已归档",
  queued: "排队中",
  running: "进行中",
  succeeded: "已完成",
  failed: "失败",
  canceled: "已取消",
  typeScript: "脚本",
  typeStoryboard: "分镜",
  typeImages: "图片",
  typeVideos: "视频",
} as const;

function formatDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);

  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatSize(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncateCopy(value: string | null | undefined, maxLength = 96) {
  const normalized = value?.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return null;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}…`;
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

function mapProjectStatusTone(status: string): StatusBadgeProps["tone"] {
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

function mapTaskType(type: string) {
  switch (type) {
    case "SCRIPT_FINALIZE":
      return copy.typeScript;
    case "STORYBOARD":
      return copy.typeStoryboard;
    case "IMAGE":
      return copy.typeImages;
    case "VIDEO":
      return copy.typeVideos;
    default:
      return type;
  }
}

function getStageBadge(hasOutput: boolean, isReady: boolean) {
  if (hasOutput) {
    return {
      badgeLabel: copy.badgeDone,
      tone: "active" as const,
    };
  }

  if (isReady) {
    return {
      badgeLabel: copy.badgeReady,
      tone: "warning" as const,
    };
  }

  return {
    badgeLabel: copy.badgeWaiting,
    tone: "neutral" as const,
  };
}

function formatBindingSummary(labels: string[], count: number) {
  if (count === 0) {
    return copy.noDefaultBinding;
  }

  return `${count}${copy.itemsSuffix} · ${labels.join("、")}`;
}

export default async function ProjectDetailPage({ params }: PageProps) {
  const [{ projectId }, user] = await Promise.all([
    Promise.resolve(params),
    requireUser(),
  ]);
  const project = await getProjectDetail(projectId, user.userId);
  const latestScript = project.scriptVersions[0];
  const latestStoryboard = project.storyboardVersions[0];
  const latestGeneratedImage = project.imageAssets.find(
    (asset) => asset.kind === "image_generated",
  );
  const latestVideo = project.videoAssets[0];
  const latestTask = project.taskHistory[0];

  return (
    <div style={pageStyle}>
      <PageHero
        eyebrow={copy.eyebrow}
        title={project.title}
        description={project.idea?.trim() || copy.noIdea}
        actions={
          <>
            <Link href="/workspace" style={secondaryActionStyle}>
              {copy.backToWorkspace}
            </Link>
            <Link href={`/projects/${project.id}/script`} style={primaryActionStyle}>
              {copy.continueScriptWorkflow}
            </Link>
          </>
        }
        supportingContent={
          <div style={heroSupportStyle}>
            <div style={heroMetaGridStyle}>
              <article style={heroMetaCardStyle}>
                <span style={heroMetaLabelStyle}>{copy.heroStatusLabel}</span>
                <StatusBadge
                  label={mapProjectStatus(project.status)}
                  tone={mapProjectStatusTone(project.status)}
                />
              </article>
              <article style={heroMetaCardStyle}>
                <span style={heroMetaLabelStyle}>{copy.heroUpdatedLabel}</span>
                <strong style={heroMetaValueStyle}>{formatDate(project.updatedAt)}</strong>
              </article>
            </div>
            <article style={heroFocusCardStyle}>
              <span style={heroMetaLabelStyle}>{copy.heroFocusLabel}</span>
              <strong style={heroFocusValueStyle}>
                {latestTask
                  ? `${mapTaskType(latestTask.type)} · ${mapTaskStatus(latestTask.status)}`
                  : copy.noRecentTask}
              </strong>
              {latestTask ? (
                <p style={heroFocusDetailStyle}>
                  {copy.latestTaskPrefix}
                  {formatDate(latestTask.createdAt)}
                </p>
              ) : null}
            </article>
          </div>
        }
      />

      <WorkflowRail
        title={copy.workflowTitle}
        layout="cards"
        items={[
          {
            label: "Script",
            detail: latestScript
              ? `${copy.workflowScriptDetailPrefix}${latestScript.versionNumber} · ${formatDate(latestScript.createdAt)}`
              : copy.workflowScriptEmpty,
            summary:
              truncateCopy(latestScript?.body) ?? copy.workflowScriptEmpty,
            href: `/projects/${project.id}/script`,
            ctaLabel: copy.workflowScriptLink,
            ...getStageBadge(Boolean(latestScript), Boolean(project.idea?.trim())),
          },
          {
            label: "Storyboard",
            detail: latestStoryboard
              ? `${latestStoryboard.frameCount}${copy.workflowStoryboardDetailSuffix} · ${formatDate(latestStoryboard.createdAt)}`
              : copy.workflowStoryboardEmpty,
            summary: latestStoryboard
              ? `${copy.storyboardScriptPrefix}${latestStoryboard.scriptVersionId}`
              : copy.workflowStoryboardEmpty,
            href: `/projects/${project.id}/storyboard`,
            ctaLabel: copy.workflowStoryboardLink,
            ...getStageBadge(Boolean(latestStoryboard), Boolean(latestScript)),
          },
          {
            label: "Images",
            detail: latestGeneratedImage
              ? `${latestGeneratedImage.originalName ?? latestGeneratedImage.id} · ${formatSize(latestGeneratedImage.sizeBytes)}`
              : copy.workflowImagesEmpty,
            summary: latestGeneratedImage
              ? `${latestGeneratedImage.mimeType} · ${formatDate(latestGeneratedImage.createdAt)}`
              : copy.workflowImagesEmpty,
            href: `/projects/${project.id}/images`,
            ctaLabel: copy.workflowImageLink,
            ...getStageBadge(Boolean(latestGeneratedImage), Boolean(latestStoryboard)),
          },
          {
            label: "Videos",
            detail: latestVideo
              ? `${latestVideo.originalName ?? latestVideo.id} · ${formatSize(latestVideo.sizeBytes)}`
              : copy.workflowVideosEmpty,
            summary: latestVideo
              ? `${latestVideo.mimeType} · ${formatDate(latestVideo.createdAt)}`
              : copy.workflowVideosEmpty,
            href: `/projects/${project.id}/videos`,
            ctaLabel: copy.workflowVideoLink,
            ...getStageBadge(Boolean(latestVideo), Boolean(latestGeneratedImage)),
          },
        ]}
      />

      <article style={panelStyle}>
        <div style={sectionHeaderStyle}>
          <h2 style={sectionTitleStyle}>{copy.assetOverviewHeading}</h2>
          <p style={sectionDescriptionStyle}>{copy.assetOverviewDescription}</p>
        </div>
        <div style={assetOverviewGridStyle}>
          <article style={summaryCardStyle}>
            <span style={summaryLabelStyle}>{copy.assetOverviewScriptCount}</span>
            <strong style={summaryValueStyle}>{project.assetCounts.script}</strong>
          </article>
          <article style={summaryCardStyle}>
            <span style={summaryLabelStyle}>{copy.assetOverviewImageCount}</span>
            <strong style={summaryValueStyle}>{project.assetCounts.image}</strong>
          </article>
          <article style={summaryCardStyle}>
            <span style={summaryLabelStyle}>{copy.assetOverviewVideoCount}</span>
            <strong style={summaryValueStyle}>{project.assetCounts.video}</strong>
          </article>
          <article style={summaryCardStyle}>
            <span style={summaryLabelStyle}>{copy.currentStoryboardBinding}</span>
            <strong style={summaryValueStyle}>
              {project.bindingSummary.storyboardScriptLabel ?? copy.noDefaultBinding}
            </strong>
            <span style={summaryMetaStyle}>
              {copy.currentImageBindings}：{" "}
              {formatBindingSummary(
                project.bindingSummary.imageReferenceLabels,
                project.bindingSummary.imageReferenceCount,
              )}
            </span>
            <span style={summaryMetaStyle}>
              {copy.currentVideoBindings}：{" "}
              {formatBindingSummary(
                project.bindingSummary.videoReferenceLabels,
                project.bindingSummary.videoReferenceCount,
              )}
            </span>
          </article>
        </div>
        <div style={overviewActionRowStyle}>
          <Link href={`/projects/${project.id}/assets`} style={secondaryActionStyle}>
            {copy.assetOverviewLink}
          </Link>
        </div>
      </article>

      <div style={historyStackStyle}>
        <section style={sectionGridStyle}>
          <article style={panelStyle}>
            <div style={sectionHeaderStyle}>
              <h2 style={sectionTitleStyle}>{copy.scriptsHeading}</h2>
              <p style={sectionDescriptionStyle}>{copy.scriptsDescription}</p>
            </div>
            {project.scriptVersions.length === 0 ? (
              <p style={emptyStyle}>{copy.scriptsEmpty}</p>
            ) : (
              <div style={stackStyle}>
                {project.scriptVersions.map((version) => (
                  <article key={version.id} style={historyCardStyle}>
                    <div style={historyCardHeaderStyle}>
                      <strong style={historyCardTitleStyle}>
                        {copy.scriptVersionPrefix}
                        {version.versionNumber}
                      </strong>
                      <span style={metaStyle}>{formatDate(version.createdAt)}</span>
                    </div>
                    <p style={bodyStyle}>
                      {version.body?.trim() || copy.noScriptBody}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </article>

          <article style={panelStyle}>
            <div style={sectionHeaderStyle}>
              <h2 style={sectionTitleStyle}>{copy.storyboardsHeading}</h2>
              <p style={sectionDescriptionStyle}>{copy.storyboardsDescription}</p>
            </div>
            {project.storyboardVersions.length === 0 ? (
              <p style={emptyStyle}>{copy.storyboardsEmpty}</p>
            ) : (
              <div style={stackStyle}>
                {project.storyboardVersions.map((version) => (
                  <article key={version.id} style={historyCardStyle}>
                    <div style={historyCardHeaderStyle}>
                      <strong style={historyCardTitleStyle}>
                        {version.frameCount}
                        {copy.storyboardFramesSuffix}
                      </strong>
                      <span style={metaStyle}>{formatDate(version.createdAt)}</span>
                    </div>
                    <span style={metaStyle}>
                      {copy.storyboardScriptPrefix}
                      {version.scriptVersionId}
                    </span>
                    <span style={metaStyle}>{version.taskId}</span>
                  </article>
                ))}
              </div>
            )}
          </article>
        </section>

        <section style={sectionGridStyle}>
          <article style={panelStyle}>
            <div style={sectionHeaderStyle}>
              <h2 style={sectionTitleStyle}>{copy.imagesHeading}</h2>
              <p style={sectionDescriptionStyle}>{copy.imagesDescription}</p>
            </div>
            {project.imageAssets.length === 0 ? (
              <p style={emptyStyle}>{copy.imagesEmpty}</p>
            ) : (
              <div style={previewGridStyle}>
                {project.imageAssets.map((asset) => (
                  <article key={asset.id} style={previewCardStyle}>
                    {asset.previewDataUrl ? (
                      <img
                        src={asset.previewDataUrl}
                        alt={asset.originalName ?? asset.id}
                        style={imageStyle}
                      />
                    ) : (
                      <div style={placeholderStyle}>{copy.assetPreviewUnavailable}</div>
                    )}
                    <div style={previewCopyStyle}>
                      <div style={historyCardHeaderStyle}>
                        <strong style={historyCardTitleStyle}>{asset.id}</strong>
                        <span style={metaStyle}>{formatSize(asset.sizeBytes)}</span>
                      </div>
                      <span style={metaStyle}>{asset.originalName ?? asset.id}</span>
                      <span style={metaStyle}>
                        {asset.mimeType} · {formatDate(asset.createdAt)}
                      </span>
                      <Link href={asset.downloadUrl} style={downloadLinkStyle}>
                        {copy.assetDownloadPrefix}
                        {asset.originalName ?? asset.id}
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </article>

          <article style={panelStyle}>
            <div style={sectionHeaderStyle}>
              <h2 style={sectionTitleStyle}>{copy.videosHeading}</h2>
              <p style={sectionDescriptionStyle}>{copy.videosDescription}</p>
            </div>
            {project.videoAssets.length === 0 ? (
              <p style={emptyStyle}>{copy.videosEmpty}</p>
            ) : (
              <div style={previewGridStyle}>
                {project.videoAssets.map((asset) => (
                  <article key={asset.id} style={previewCardStyle}>
                    {asset.previewUrl ? (
                      <video
                        controls
                        preload="metadata"
                        src={asset.previewUrl}
                        style={videoStyle}
                      />
                    ) : (
                      <div style={placeholderStyle}>{copy.assetPreviewUnavailable}</div>
                    )}
                    <div style={previewCopyStyle}>
                      <div style={historyCardHeaderStyle}>
                        <strong style={historyCardTitleStyle}>{asset.id}</strong>
                        <span style={metaStyle}>{formatSize(asset.sizeBytes)}</span>
                      </div>
                      <span style={metaStyle}>{asset.originalName ?? asset.id}</span>
                      <span style={metaStyle}>
                        {asset.mimeType} · {formatDate(asset.createdAt)}
                      </span>
                      <Link href={asset.downloadUrl} style={downloadLinkStyle}>
                        {copy.assetDownloadPrefix}
                        {asset.originalName ?? asset.id}
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </article>
        </section>

        <article style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <h2 style={sectionTitleStyle}>{copy.taskHistoryHeading}</h2>
            <p style={sectionDescriptionStyle}>{copy.taskHistoryDescription}</p>
          </div>
          {project.taskHistory.length === 0 ? (
            <p style={emptyStyle}>{copy.taskHistoryEmpty}</p>
          ) : (
            <div style={stackStyle}>
              {project.taskHistory.map((task) => (
                <article key={task.id} style={historyCardStyle}>
                  <div style={historyCardHeaderStyle}>
                    <strong style={historyCardTitleStyle}>{task.id}</strong>
                    <StatusBadge
                      label={mapTaskStatus(task.status)}
                      tone={
                        task.status === "FAILED"
                          ? "danger"
                          : task.status === "SUCCEEDED"
                            ? "active"
                            : "warning"
                      }
                    />
                  </div>
                  <span style={metaStyle}>{mapTaskType(task.type)}</span>
                  <span style={metaStyle}>
                    {copy.taskCreatedPrefix}
                    {formatDate(task.createdAt)}
                  </span>
                  {task.finishedAt ? (
                    <span style={metaStyle}>
                      {copy.taskFinishedPrefix}
                      {formatDate(task.finishedAt)}
                    </span>
                  ) : null}
                  {task.errorText ? (
                    <p style={errorStyle}>
                      {copy.taskErrorPrefix}
                      {task.errorText}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </article>
      </div>
    </div>
  );
}

const pageStyle = {
  display: "grid",
  gap: "24px",
} satisfies CSSProperties;

const heroSupportStyle = {
  display: "grid",
  gap: "14px",
} satisfies CSSProperties;

const heroMetaGridStyle = {
  display: "grid",
  gap: "12px",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
} satisfies CSSProperties;

const heroMetaCardStyle = {
  display: "grid",
  gap: "10px",
  padding: "14px",
  borderRadius: "18px",
  border: "1px solid rgba(129, 140, 248, 0.18)",
  background: "rgba(8, 10, 26, 0.3)",
} satisfies CSSProperties;

const heroFocusCardStyle = {
  ...heroMetaCardStyle,
  gap: "8px",
} satisfies CSSProperties;

const heroMetaLabelStyle = {
  color: "var(--text-muted)",
  fontSize: "0.82rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
} satisfies CSSProperties;

const heroMetaValueStyle = {
  fontSize: "1rem",
  lineHeight: 1.4,
} satisfies CSSProperties;

const heroFocusValueStyle = {
  fontSize: "1rem",
  lineHeight: 1.6,
} satisfies CSSProperties;

const heroFocusDetailStyle = {
  margin: 0,
  color: "var(--text-muted)",
  lineHeight: 1.6,
} satisfies CSSProperties;

const primaryActionStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "42px",
  padding: "0 18px",
  borderRadius: "999px",
  background:
    "linear-gradient(135deg, rgba(109, 94, 252, 0.95), rgba(129, 140, 248, 0.72))",
  color: "#fff",
  textDecoration: "none",
  fontWeight: 700,
} satisfies CSSProperties;

const secondaryActionStyle = {
  ...primaryActionStyle,
  background: "rgba(248, 250, 252, 0.08)",
  border: "1px solid rgba(248, 250, 252, 0.12)",
  color: "var(--text)",
} satisfies CSSProperties;

const historyStackStyle = {
  display: "grid",
  gap: "20px",
} satisfies CSSProperties;

const sectionGridStyle = {
  display: "grid",
  gap: "20px",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
} satisfies CSSProperties;

const panelStyle = {
  display: "grid",
  gap: "16px",
  padding: "22px",
  borderRadius: "24px",
  border: "1px solid var(--border)",
  background: "rgba(22, 24, 39, 0.88)",
  boxShadow: "var(--shadow-panel)",
} satisfies CSSProperties;

const sectionHeaderStyle = {
  display: "grid",
  gap: "8px",
} satisfies CSSProperties;

const sectionTitleStyle = {
  margin: 0,
  fontSize: "1.2rem",
} satisfies CSSProperties;

const sectionDescriptionStyle = {
  margin: 0,
  color: "var(--text-muted)",
  lineHeight: 1.6,
} satisfies CSSProperties;

const stackStyle = {
  display: "grid",
  gap: "14px",
} satisfies CSSProperties;

const assetOverviewGridStyle = {
  display: "grid",
  gap: "16px",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
} satisfies CSSProperties;

const summaryCardStyle = {
  display: "grid",
  gap: "8px",
  padding: "16px",
  borderRadius: "18px",
  border: "1px solid rgba(129, 140, 248, 0.16)",
  background: "rgba(8, 10, 26, 0.26)",
} satisfies CSSProperties;

const summaryLabelStyle = {
  color: "var(--text-muted)",
  lineHeight: 1.6,
} satisfies CSSProperties;

const summaryValueStyle = {
  fontSize: "1.15rem",
  lineHeight: 1.5,
  wordBreak: "break-word",
} satisfies CSSProperties;

const summaryMetaStyle = {
  color: "var(--text-muted)",
  lineHeight: 1.6,
  wordBreak: "break-word",
} satisfies CSSProperties;

const overviewActionRowStyle = {
  display: "flex",
  justifyContent: "flex-start",
} satisfies CSSProperties;

const historyCardStyle = {
  display: "grid",
  gap: "8px",
  padding: "16px",
  borderRadius: "18px",
  border: "1px solid rgba(129, 140, 248, 0.16)",
  background: "rgba(8, 10, 26, 0.26)",
} satisfies CSSProperties;

const historyCardHeaderStyle = {
  display: "flex",
  alignItems: "start",
  justifyContent: "space-between",
  gap: "12px",
  flexWrap: "wrap",
} satisfies CSSProperties;

const historyCardTitleStyle = {
  fontSize: "1rem",
  lineHeight: 1.5,
  wordBreak: "break-word",
} satisfies CSSProperties;

const metaStyle = {
  color: "var(--text-muted)",
  lineHeight: 1.6,
  wordBreak: "break-word",
} satisfies CSSProperties;

const bodyStyle = {
  margin: 0,
  color: "var(--text)",
  lineHeight: 1.7,
  whiteSpace: "pre-wrap",
} satisfies CSSProperties;

const emptyStyle = {
  margin: 0,
  color: "var(--text-muted)",
  lineHeight: 1.7,
} satisfies CSSProperties;

const previewGridStyle = {
  display: "grid",
  gap: "16px",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
} satisfies CSSProperties;

const previewCardStyle = {
  display: "grid",
  gap: "14px",
  alignContent: "start",
  padding: "16px",
  borderRadius: "20px",
  border: "1px solid rgba(129, 140, 248, 0.16)",
  background: "rgba(8, 10, 26, 0.26)",
} satisfies CSSProperties;

const previewCopyStyle = {
  display: "grid",
  gap: "8px",
} satisfies CSSProperties;

const placeholderStyle = {
  width: "100%",
  aspectRatio: "4 / 3",
  borderRadius: "16px",
  border: "1px dashed rgba(129, 140, 248, 0.26)",
  background:
    "linear-gradient(135deg, rgba(31, 33, 67, 0.48), rgba(15, 23, 42, 0.52))",
  display: "grid",
  placeItems: "center",
  color: "var(--text-muted)",
} satisfies CSSProperties;

const imageStyle = {
  width: "100%",
  aspectRatio: "4 / 3",
  objectFit: "cover",
  borderRadius: "16px",
  border: "1px solid rgba(129, 140, 248, 0.16)",
} satisfies CSSProperties;

const videoStyle = {
  width: "100%",
  aspectRatio: "16 / 9",
  objectFit: "cover",
  borderRadius: "16px",
  border: "1px solid rgba(129, 140, 248, 0.16)",
  background: "#000",
} satisfies CSSProperties;

const downloadLinkStyle = {
  width: "fit-content",
  color: "var(--text)",
  fontWeight: 700,
  textDecoration: "none",
} satisfies CSSProperties;

const errorStyle = {
  margin: 0,
  color: "#fca5a5",
  fontWeight: 700,
  lineHeight: 1.6,
} satisfies CSSProperties;
