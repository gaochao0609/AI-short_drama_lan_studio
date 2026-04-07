"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import Link from "next/link";
import AssetCard from "@/components/project-assets/asset-card";
import AssetUploadPanel from "@/components/project-assets/asset-upload-panel";
import PageHero from "@/components/studio/page-hero";
import StatusBadge from "@/components/studio/status-badge";
import WorkflowRail from "@/components/studio/workflow-rail";
import type { ProjectWorkflowBindingSummary } from "@/lib/services/asset-bindings";
import type { GroupedProjectAssets } from "@/lib/services/assets";

type AssetCategory = keyof GroupedProjectAssets;
type AssetSummary = GroupedProjectAssets[AssetCategory][number];

type AssetCenterClientProps = {
  project: {
    id: string;
    title: string;
  };
  initialAssets: GroupedProjectAssets;
  initialBindings: ProjectWorkflowBindingSummary;
};

type AssetsRoutePayload = {
  project: {
    id: string;
    title: string;
  };
  assets: GroupedProjectAssets;
  bindings: ProjectWorkflowBindingSummary;
};

const GROUP_ORDER: AssetCategory[] = [
  "script_source",
  "script_generated",
  "image_source",
  "image_generated",
  "video_generated",
];

const GROUP_COPY: Record<
  AssetCategory,
  {
    title: string;
    description: string;
  }
> = {
  script_source: {
    title: "上传剧本",
    description: "用户上传的剧本文档，解析成功后可设为分镜默认输入。",
  },
  script_generated: {
    title: "系统剧本",
    description: "由脚本流程沉淀下来的系统结果，方便后续回看与绑定。",
  },
  image_source: {
    title: "上传图片",
    description: "项目上传的参考图，可加入图片或视频流程默认参考。",
  },
  image_generated: {
    title: "生成图片",
    description: "图片流程生成结果，可继续绑定到后续流程。",
  },
  video_generated: {
    title: "生成视频",
    description: "视频流程产出的最终结果，统一在此查看和下载。",
  },
};

function getTotalAssetCount(assets: GroupedProjectAssets) {
  return GROUP_ORDER.reduce((count, key) => count + assets[key].length, 0);
}

function mapAssetEntries(assets: GroupedProjectAssets) {
  return GROUP_ORDER.flatMap((groupKey) => assets[groupKey]);
}

function readAssetDisplayName(asset: AssetSummary | undefined, fallback: string) {
  return asset?.originalName?.trim() || fallback;
}

function readErrorText(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const value = payload.error;

    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return fallback;
}

export default function AssetCenterClient({
  project,
  initialAssets,
  initialBindings,
}: Readonly<AssetCenterClientProps>) {
  const [assets, setAssets] = useState(initialAssets);
  const [bindings, setBindings] = useState(initialBindings);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const totalAssetCount = useMemo(() => getTotalAssetCount(assets), [assets]);
  const hasAssets = totalAssetCount > 0;
  const hasDefaultBinding =
    Boolean(bindings.storyboardScriptAssetId) ||
    bindings.imageReferenceAssetIds.length > 0 ||
    bindings.videoReferenceAssetIds.length > 0;
  const assetMap = useMemo(
    () => new Map(mapAssetEntries(assets).map((asset) => [asset.id, asset])),
    [assets],
  );
  const groupedSections = GROUP_ORDER.filter((key) => assets[key].length > 0);

  async function refreshWorkspace() {
    const response = await fetch(`/api/projects/${project.id}/assets`, {
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as AssetsRoutePayload | { error?: string } | null;

    if (!response.ok || !payload || !("assets" in payload) || !("bindings" in payload)) {
      throw new Error(readErrorText(payload, "刷新资产中心失败"));
    }

    setAssets(payload.assets);
    setBindings(payload.bindings);
  }

  async function uploadAsset(file: File) {
    setBusyKey("upload");
    setNotice(null);
    setError(null);

    try {
      const form = new FormData();
      form.set("file", file);

      const response = await fetch(`/api/projects/${project.id}/assets`, {
        method: "POST",
        body: form,
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(readErrorText(payload, "上传资产失败"));
      }

      await refreshWorkspace();
      setNotice("资产已上传。");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "上传资产失败");
    } finally {
      setBusyKey(null);
    }
  }

  async function deleteAsset(assetId: string) {
    if (typeof window !== "undefined" && !window.confirm(`确认删除资产 ${assetId} 吗？`)) {
      return;
    }

    setBusyKey(`delete:${assetId}`);
    setNotice(null);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${project.id}/assets/${assetId}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(readErrorText(payload, "删除资产失败"));
      }

      await refreshWorkspace();
      setNotice("资产已删除。");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除资产失败");
    } finally {
      setBusyKey(null);
    }
  }

  async function retryAsset(assetId: string) {
    setBusyKey(`retry:${assetId}`);
    setNotice(null);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${project.id}/assets/${assetId}/retry`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(readErrorText(payload, "重试解析失败"));
      }

      await refreshWorkspace();
      setNotice("已重新提交解析任务。");
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "重试解析失败");
    } finally {
      setBusyKey(null);
    }
  }

  async function patchBindings(nextBindings: Partial<ProjectWorkflowBindingSummary>) {
    setBusyKey("binding");
    setNotice(null);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${project.id}/workflow-binding`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(nextBindings),
      });
      const payload = (await response.json().catch(() => null)) as
        | ProjectWorkflowBindingSummary
        | { error?: string }
        | null;

      if (
        !response.ok ||
        !payload ||
        !("storyboardScriptAssetId" in payload) ||
        !("imageReferenceAssetIds" in payload) ||
        !("videoReferenceAssetIds" in payload)
      ) {
        throw new Error(readErrorText(payload, "更新默认绑定失败"));
      }

      setBindings(payload);
      setNotice("默认绑定已更新。");
    } catch (bindingError) {
      setError(bindingError instanceof Error ? bindingError.message : "更新默认绑定失败");
    } finally {
      setBusyKey(null);
    }
  }

  function toggleImageReference(assetId: string) {
    const exists = bindings.imageReferenceAssetIds.includes(assetId);
    const nextAssetIds = exists
      ? bindings.imageReferenceAssetIds.filter((id) => id !== assetId)
      : [...bindings.imageReferenceAssetIds, assetId];

    return patchBindings({
      imageReferenceAssetIds: nextAssetIds,
    });
  }

  function toggleVideoReference(assetId: string) {
    const exists = bindings.videoReferenceAssetIds.includes(assetId);
    const nextAssetIds = exists
      ? bindings.videoReferenceAssetIds.filter((id) => id !== assetId)
      : [...bindings.videoReferenceAssetIds, assetId];

    return patchBindings({
      videoReferenceAssetIds: nextAssetIds,
    });
  }

  function readAssetLabel(assetId: string | null) {
    if (!assetId) {
      return "未设置";
    }

    return readAssetDisplayName(assetMap.get(assetId), assetId);
  }

  function readBindingLabels(assetIds: string[]) {
    if (assetIds.length === 0) {
      return "未设置";
    }

    return assetIds.map((assetId) => readAssetLabel(assetId)).join("、");
  }

  return (
    <div style={pageStyle}>
      <PageHero
        eyebrow="项目制作流程"
        title="资产中心"
        description="统一管理上传素材、系统生成结果和项目级默认绑定。"
        actions={
          <Link href={`/projects/${project.id}`} style={secondaryActionStyle}>
            返回项目制作台
          </Link>
        }
        supportingContent={
          <div style={heroSupportStyle}>
            <div style={heroSupportHeaderStyle}>
              <span style={heroMetaLabelStyle}>当前项目</span>
              <StatusBadge
                label={hasDefaultBinding ? "默认绑定已配置" : "待配置默认绑定"}
                tone={hasDefaultBinding ? "active" : "warning"}
              />
            </div>
            <h2 style={heroSupportTitleStyle}>{project.title}</h2>
            <p style={heroSupportBodyStyle}>
              {hasAssets
                ? `当前共归档 ${totalAssetCount} 项资产，后续流程会默认读取这里的绑定配置。`
                : "当前项目还没有资产，请先上传剧本或图片。"}
            </p>
          </div>
        }
      />

      <WorkflowRail
        title="资产中心流程"
        layout="cards"
        items={[
          {
            label: "上传素材",
            detail: hasAssets ? `当前已归档 ${totalAssetCount} 项资产。` : "先上传剧本或图片素材。",
            summary: "上传后的素材与系统生成结果都会统一沉淀到这里。",
            badgeLabel: hasAssets ? "已归档" : "待开始",
            tone: hasAssets ? "active" : "neutral",
          },
          {
            label: "设置默认绑定",
            detail: hasDefaultBinding ? "分镜、图片、视频默认输入已配置。" : "当前还没有默认绑定。",
            summary: "流程页会默认读取这里的项目级绑定，不需要重复上传。",
            badgeLabel: hasDefaultBinding ? "已配置" : "待配置",
            tone: hasDefaultBinding ? "active" : "warning",
          },
          {
            label: "进入流程",
            detail: "绑定设置完成后，可直接进入分镜、图片或视频阶段。",
            summary: "流程页保留轻量改选能力，但默认输入以资产中心为准。",
            badgeLabel: hasDefaultBinding ? "可继续" : "先绑定",
            tone: hasDefaultBinding ? "warning" : "neutral",
          },
        ]}
      />

      {notice ? (
        <p role="status" style={statusNoticeStyle}>
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" style={errorNoticeStyle}>
          {error}
        </p>
      ) : null}

      <section style={panelStyle}>
        <AssetUploadPanel disabled={busyKey !== null} onUpload={uploadAsset} />
      </section>

      <section style={panelStyle}>
        <div style={sectionHeaderStyle}>
          <h2 style={sectionTitleStyle}>默认绑定</h2>
          <p style={sectionDescriptionStyle}>
            当前流程默认读取这些资产。需要临时改选时，后续流程页仍可单次覆盖。
          </p>
        </div>

        {hasDefaultBinding ? (
          <div style={bindingGridStyle}>
            <article style={summaryCardStyle}>
              <span style={summaryLabelStyle}>当前默认分镜剧本</span>
              <strong style={summaryValueStyle}>
                {readAssetLabel(bindings.storyboardScriptAssetId)}
              </strong>
            </article>
            <article style={summaryCardStyle}>
              <span style={summaryLabelStyle}>图片默认参考</span>
              <strong style={summaryValueStyle}>
                {bindings.imageReferenceAssetIds.length} 项
              </strong>
              <span style={summaryMetaStyle}>
                {readBindingLabels(bindings.imageReferenceAssetIds)}
              </span>
            </article>
            <article style={summaryCardStyle}>
              <span style={summaryLabelStyle}>视频默认参考</span>
              <strong style={summaryValueStyle}>
                {bindings.videoReferenceAssetIds.length} 项
              </strong>
              <span style={summaryMetaStyle}>
                {readBindingLabels(bindings.videoReferenceAssetIds)}
              </span>
            </article>
          </div>
        ) : (
          <p style={emptyStateStyle}>
            当前还没有设置默认绑定，可从资产卡片绑定到分镜、图片或视频流程。
          </p>
        )}
      </section>

      <section style={panelStyle}>
        <div style={sectionHeaderStyle}>
          <h2 style={sectionTitleStyle}>资产清单</h2>
          <p style={sectionDescriptionStyle}>
            按类别统一查看上传素材与系统结果，并在卡片内完成预览、下载、绑定、重试和删除。
          </p>
        </div>

        {!hasAssets ? (
          <p style={emptyStateStyle}>当前项目还没有资产，请先上传剧本或图片。</p>
        ) : (
          <div style={sectionStackStyle}>
            {groupedSections.map((groupKey) => (
              <section key={groupKey} style={groupSectionStyle}>
                <div style={sectionHeaderStyle}>
                  <h3 style={subsectionTitleStyle}>{GROUP_COPY[groupKey].title}</h3>
                  <p style={sectionDescriptionStyle}>{GROUP_COPY[groupKey].description}</p>
                </div>
                <div style={assetGridStyle}>
                  {assets[groupKey].map((asset) => (
                    <AssetCard
                      key={asset.id}
                      asset={asset}
                      isStoryboardBound={bindings.storyboardScriptAssetId === asset.id}
                      isImageReferenceBound={bindings.imageReferenceAssetIds.includes(asset.id)}
                      isVideoReferenceBound={bindings.videoReferenceAssetIds.includes(asset.id)}
                      disabled={busyKey !== null}
                      onBindStoryboardScript={() =>
                        patchBindings({
                          storyboardScriptAssetId: asset.id,
                        })
                      }
                      onToggleImageReference={() => toggleImageReference(asset.id)}
                      onToggleVideoReference={() => toggleVideoReference(asset.id)}
                      onRetry={() => retryAsset(asset.id)}
                      onDelete={() => deleteAsset(asset.id)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const pageStyle = {
  display: "grid",
  gap: "24px",
} satisfies CSSProperties;

const heroSupportStyle = {
  display: "grid",
  gap: "10px",
} satisfies CSSProperties;

const heroSupportHeaderStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  flexWrap: "wrap",
} satisfies CSSProperties;

const heroMetaLabelStyle = {
  color: "var(--text-muted)",
  fontSize: "0.82rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
} satisfies CSSProperties;

const heroSupportTitleStyle = {
  margin: 0,
  fontSize: "1.15rem",
  lineHeight: 1.4,
} satisfies CSSProperties;

const heroSupportBodyStyle = {
  margin: 0,
  color: "var(--text-muted)",
  lineHeight: 1.7,
} satisfies CSSProperties;

const secondaryActionStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "42px",
  padding: "0 18px",
  borderRadius: "999px",
  background: "rgba(248, 250, 252, 0.08)",
  border: "1px solid rgba(248, 250, 252, 0.12)",
  color: "var(--text)",
  textDecoration: "none",
  fontWeight: 700,
} satisfies CSSProperties;

const statusNoticeStyle = {
  margin: 0,
  padding: "16px 18px",
  borderRadius: "18px",
  border: "1px solid rgba(74, 222, 128, 0.2)",
  background: "rgba(21, 128, 61, 0.16)",
  color: "#dcfce7",
  lineHeight: 1.6,
} satisfies CSSProperties;

const errorNoticeStyle = {
  margin: 0,
  padding: "16px 18px",
  borderRadius: "18px",
  border: "1px solid rgba(248, 113, 113, 0.24)",
  background: "rgba(127, 29, 29, 0.24)",
  color: "#fecaca",
  lineHeight: 1.6,
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

const subsectionTitleStyle = {
  margin: 0,
  fontSize: "1.05rem",
} satisfies CSSProperties;

const sectionDescriptionStyle = {
  margin: 0,
  color: "var(--text-muted)",
  lineHeight: 1.6,
} satisfies CSSProperties;

const bindingGridStyle = {
  display: "grid",
  gap: "14px",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
} satisfies CSSProperties;

const summaryCardStyle = {
  display: "grid",
  gap: "8px",
  padding: "16px",
  borderRadius: "20px",
  border: "1px solid rgba(129, 140, 248, 0.18)",
  background: "rgba(8, 10, 26, 0.32)",
} satisfies CSSProperties;

const summaryLabelStyle = {
  color: "var(--text-muted)",
  lineHeight: 1.6,
} satisfies CSSProperties;

const summaryValueStyle = {
  fontSize: "1rem",
  lineHeight: 1.5,
  wordBreak: "break-word",
} satisfies CSSProperties;

const summaryMetaStyle = {
  color: "var(--text-muted)",
  lineHeight: 1.6,
  wordBreak: "break-word",
} satisfies CSSProperties;

const emptyStateStyle = {
  margin: 0,
  color: "var(--text-muted)",
  lineHeight: 1.7,
} satisfies CSSProperties;

const sectionStackStyle = {
  display: "grid",
  gap: "20px",
} satisfies CSSProperties;

const groupSectionStyle = {
  display: "grid",
  gap: "14px",
} satisfies CSSProperties;

const assetGridStyle = {
  display: "grid",
  gap: "16px",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
} satisfies CSSProperties;
