"use client";

import type { CSSProperties } from "react";
import { useRef } from "react";

type AssetUploadPanelProps = {
  disabled?: boolean;
  onUpload: (file: File) => Promise<void> | void;
};

export default function AssetUploadPanel({
  disabled = false,
  onUpload,
}: Readonly<AssetUploadPanelProps>) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function openPicker() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    event.target.value = "";
    await onUpload(file);
  }

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <h2 style={titleStyle}>上传素材</h2>
        <p style={descriptionStyle}>
          统一接收剧本文本和图片素材，上传后自动进入项目资产清单。
        </p>
      </div>
      <div style={actionRowStyle}>
        <button
          type="button"
          aria-label="上传剧本或图片"
          onClick={openPicker}
          disabled={disabled}
          style={primaryButtonStyle}
        >
          上传剧本或图片
        </button>
        <span style={helperTextStyle}>支持 `.txt`、`.md`、PNG、JPG、WEBP</span>
      </div>
      <input
        ref={fileInputRef}
        hidden
        type="file"
        accept=".txt,.md,image/png,image/jpeg,image/webp"
        onChange={(event) => void handleFileChange(event)}
      />
    </div>
  );
}

const panelStyle = {
  display: "grid",
  gap: "14px",
} satisfies CSSProperties;

const headerStyle = {
  display: "grid",
  gap: "8px",
} satisfies CSSProperties;

const titleStyle = {
  margin: 0,
  fontSize: "1.1rem",
} satisfies CSSProperties;

const descriptionStyle = {
  margin: 0,
  color: "var(--text-muted)",
  lineHeight: 1.6,
} satisfies CSSProperties;

const actionRowStyle = {
  display: "flex",
  gap: "12px",
  flexWrap: "wrap",
  alignItems: "center",
} satisfies CSSProperties;

const primaryButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "42px",
  padding: "0 18px",
  borderRadius: "999px",
  border: 0,
  background:
    "linear-gradient(135deg, rgba(109, 94, 252, 0.95), rgba(129, 140, 248, 0.72))",
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer",
} satisfies CSSProperties;

const helperTextStyle = {
  color: "var(--text-muted)",
  lineHeight: 1.6,
} satisfies CSSProperties;
