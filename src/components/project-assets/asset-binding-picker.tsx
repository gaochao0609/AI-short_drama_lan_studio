"use client";

import type { CSSProperties } from "react";
import { useState } from "react";

type AssetBindingPickerProps = {
  assetId: string;
  isScriptAsset: boolean;
  isImageAsset: boolean;
  isStoryboardBound: boolean;
  isImageReferenceBound: boolean;
  isVideoReferenceBound: boolean;
  disabled?: boolean;
  onBindStoryboardScript: () => Promise<void> | void;
  onToggleImageReference: () => Promise<void> | void;
  onToggleVideoReference: () => Promise<void> | void;
};

export default function AssetBindingPicker({
  assetId,
  isScriptAsset,
  isImageAsset,
  isStoryboardBound,
  isImageReferenceBound,
  isVideoReferenceBound,
  disabled = false,
  onBindStoryboardScript,
  onToggleImageReference,
  onToggleVideoReference,
}: Readonly<AssetBindingPickerProps>) {
  const [isOpen, setIsOpen] = useState(false);
  const hasBindingActions = isScriptAsset || isImageAsset;

  if (!hasBindingActions) {
    return null;
  }

  async function runAction(action: () => Promise<void> | void) {
    await action();
    setIsOpen(false);
  }

  return (
    <div style={pickerStyle}>
      <button
        type="button"
        aria-label="绑定到流程"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        disabled={disabled}
        style={secondaryButtonStyle}
      >
        绑定到流程
      </button>
      {isOpen ? (
        <div style={menuStyle}>
          {isScriptAsset ? (
            <button
              type="button"
              aria-label={`${assetId} 设为分镜默认输入`}
              onClick={() => void runAction(onBindStoryboardScript)}
              disabled={disabled || isStoryboardBound}
              style={menuButtonStyle}
            >
              {isStoryboardBound ? "已设为分镜默认输入" : "设为分镜默认输入"}
            </button>
          ) : null}
          {isImageAsset ? (
            <button
              type="button"
              aria-label={`${assetId} 切换图片默认参考`}
              onClick={() => void runAction(onToggleImageReference)}
              disabled={disabled}
              style={menuButtonStyle}
            >
              {isImageReferenceBound ? "移出图片默认参考" : "加入图片默认参考"}
            </button>
          ) : null}
          {isImageAsset ? (
            <button
              type="button"
              aria-label={`${assetId} 切换视频默认参考`}
              onClick={() => void runAction(onToggleVideoReference)}
              disabled={disabled}
              style={menuButtonStyle}
            >
              {isVideoReferenceBound ? "移出视频默认参考" : "加入视频默认参考"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const pickerStyle = {
  display: "grid",
  gap: "10px",
} satisfies CSSProperties;

const secondaryButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "38px",
  padding: "0 14px",
  borderRadius: "999px",
  border: "1px solid rgba(129, 140, 248, 0.24)",
  background: "rgba(248, 250, 252, 0.08)",
  color: "var(--text)",
  fontWeight: 700,
  cursor: "pointer",
} satisfies CSSProperties;

const menuStyle = {
  display: "grid",
  gap: "8px",
  padding: "12px",
  borderRadius: "18px",
  border: "1px solid rgba(129, 140, 248, 0.18)",
  background: "rgba(8, 10, 26, 0.6)",
} satisfies CSSProperties;

const menuButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "36px",
  padding: "0 12px",
  borderRadius: "14px",
  border: "1px solid rgba(202, 138, 4, 0.24)",
  background: "rgba(202, 138, 4, 0.12)",
  color: "var(--text)",
  fontWeight: 600,
  cursor: "pointer",
} satisfies CSSProperties;
