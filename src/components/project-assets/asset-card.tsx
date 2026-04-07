"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import StatusBadge from "@/components/studio/status-badge";
import AssetBindingPicker from "@/components/project-assets/asset-binding-picker";

type AssetCardProps = {
  asset: {
    id: string;
    originalName: string | null;
    category: "script_source" | "script_generated" | "image_source" | "image_generated" | "video_generated";
    origin: "upload" | "system";
    mimeType: string;
    parseStatus: "pending" | "ready" | "failed" | null;
    parseError: string | null;
    createdAt: string;
    downloadUrl: string;
  };
  isStoryboardBound: boolean;
  isImageReferenceBound: boolean;
  isVideoReferenceBound: boolean;
  disabled?: boolean;
  onBindStoryboardScript: () => Promise<void> | void;
  onToggleImageReference: () => Promise<void> | void;
  onToggleVideoReference: () => Promise<void> | void;
  onRetry: () => Promise<void> | void;
  onDelete: () => Promise<void> | void;
};

function formatCategoryLabel(category: AssetCardProps["asset"]["category"]) {
  switch (category) {
    case "script_source":
      return "上传剧本";
    case "script_generated":
      return "系统剧本";
    case "image_source":
      return "上传图片";
    case "image_generated":
      return "生成图片";
    case "video_generated":
      return "生成视频";
    default:
      return category;
  }
}

function formatOriginLabel(origin: AssetCardProps["asset"]["origin"]) {
  return origin === "system" ? "系统生成" : "上传素材";
}

function mapParseStatus(status: AssetCardProps["asset"]["parseStatus"]) {
  switch (status) {
    case "pending":
      return { label: "解析中", tone: "warning" as const };
    case "ready":
      return { label: "可绑定", tone: "active" as const };
    case "failed":
      return { label: "解析失败", tone: "danger" as const };
    default:
      return null;
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function AssetCard({
  asset,
  isStoryboardBound,
  isImageReferenceBound,
  isVideoReferenceBound,
  disabled = false,
  onBindStoryboardScript,
  onToggleImageReference,
  onToggleVideoReference,
  onRetry,
  onDelete,
}: Readonly<AssetCardProps>) {
  const parseStatus = mapParseStatus(asset.parseStatus);
  const isScriptAsset =
    asset.category === "script_source" || asset.category === "script_generated";
  const isImageAsset =
    asset.category === "image_source" || asset.category === "image_generated";
  const assetLabel = asset.originalName?.trim() || asset.id;

  return (
    <article aria-label={`${asset.id} 资产卡片`} style={cardStyle}>
      <div style={cardHeaderStyle}>
        <div style={cardHeadingStyle}>
          <strong style={titleStyle}>{assetLabel}</strong>
          <span style={metaStyle}>{formatCategoryLabel(asset.category)}</span>
        </div>
        {parseStatus ? (
          <StatusBadge label={parseStatus.label} tone={parseStatus.tone} />
        ) : (
          <StatusBadge label={formatOriginLabel(asset.origin)} tone="neutral" />
        )}
      </div>

      <div style={metaStackStyle}>
        <span style={metaStyle}>资产 ID：{asset.id}</span>
        <span style={metaStyle}>{asset.mimeType}</span>
        <span style={metaStyle}>创建于 {formatDate(asset.createdAt)}</span>
        {asset.parseError ? <p style={errorStyle}>{asset.parseError}</p> : null}
        {isStoryboardBound ? <span style={highlightStyle}>当前分镜默认输入</span> : null}
        {isImageReferenceBound ? <span style={highlightStyle}>已加入图片默认参考</span> : null}
        {isVideoReferenceBound ? <span style={highlightStyle}>已加入视频默认参考</span> : null}
      </div>

      <div style={linkRowStyle}>
        <Link href={asset.downloadUrl} target="_blank" rel="noreferrer" style={linkStyle}>
          预览
        </Link>
        <Link href={asset.downloadUrl} style={linkStyle}>
          下载
        </Link>
      </div>

      <AssetBindingPicker
        assetId={asset.id}
        isScriptAsset={isScriptAsset}
        isImageAsset={isImageAsset}
        isStoryboardBound={isStoryboardBound}
        isImageReferenceBound={isImageReferenceBound}
        isVideoReferenceBound={isVideoReferenceBound}
        disabled={disabled}
        onBindStoryboardScript={onBindStoryboardScript}
        onToggleImageReference={onToggleImageReference}
        onToggleVideoReference={onToggleVideoReference}
      />

      <div style={actionRowStyle}>
        {asset.category === "script_source" && asset.parseStatus === "failed" ? (
          <button
            type="button"
            aria-label="重试解析"
            onClick={() => void onRetry()}
            disabled={disabled}
            style={secondaryButtonStyle}
          >
            重试解析
          </button>
        ) : null}
        <button
          type="button"
          aria-label="删除资产"
          onClick={() => void onDelete()}
          disabled={disabled}
          style={dangerButtonStyle}
        >
          删除资产
        </button>
      </div>
    </article>
  );
}

const cardStyle = {
  display: "grid",
  gap: "14px",
  alignContent: "start",
  padding: "18px",
  borderRadius: "22px",
  border: "1px solid rgba(129, 140, 248, 0.18)",
  background: "rgba(8, 10, 26, 0.4)",
} satisfies CSSProperties;

const cardHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "start",
  flexWrap: "wrap",
} satisfies CSSProperties;

const cardHeadingStyle = {
  display: "grid",
  gap: "6px",
} satisfies CSSProperties;

const titleStyle = {
  fontSize: "1rem",
  lineHeight: 1.5,
  wordBreak: "break-word",
} satisfies CSSProperties;

const metaStackStyle = {
  display: "grid",
  gap: "6px",
} satisfies CSSProperties;

const metaStyle = {
  color: "var(--text-muted)",
  lineHeight: 1.6,
  wordBreak: "break-word",
} satisfies CSSProperties;

const highlightStyle = {
  color: "#fcd34d",
  fontWeight: 700,
  lineHeight: 1.6,
} satisfies CSSProperties;

const errorStyle = {
  margin: 0,
  color: "#fecaca",
  lineHeight: 1.6,
} satisfies CSSProperties;

const linkRowStyle = {
  display: "flex",
  gap: "12px",
  flexWrap: "wrap",
} satisfies CSSProperties;

const linkStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "38px",
  padding: "0 14px",
  borderRadius: "999px",
  border: "1px solid rgba(129, 140, 248, 0.24)",
  background: "rgba(109, 94, 252, 0.12)",
  color: "var(--text)",
  fontWeight: 700,
  textDecoration: "none",
} satisfies CSSProperties;

const actionRowStyle = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
} satisfies CSSProperties;

const secondaryButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "38px",
  padding: "0 14px",
  borderRadius: "999px",
  border: "1px solid rgba(248, 250, 252, 0.12)",
  background: "rgba(248, 250, 252, 0.08)",
  color: "var(--text)",
  fontWeight: 700,
  cursor: "pointer",
} satisfies CSSProperties;

const dangerButtonStyle = {
  ...secondaryButtonStyle,
  border: "1px solid rgba(248, 113, 113, 0.24)",
  background: "rgba(127, 29, 29, 0.24)",
  color: "#fecaca",
} satisfies CSSProperties;
