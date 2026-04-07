"use client";

import type { CSSProperties, FormEvent } from "react";
import { useEffect, useState } from "react";
import StatusBadge from "@/components/studio/status-badge";
import type { ModelTaskType } from "@/lib/models/contracts";

type ProviderItem = {
  id: string;
  key: string;
  label: string;
  providerName: string;
  modelName: string | null;
  baseUrl: string | null;
  apiKeyMaskedTail: string | null;
  timeoutMs: number;
  maxRetries: number;
  enabled: boolean;
  configJson: {
    defaultForTasks: ModelTaskType[];
  };
  updatedAt: string;
};

type DefaultModelItem = {
  taskType: ModelTaskType;
  providerKey: string;
  label: string;
  providerName: string;
  model: string | null;
} | null;

type ProviderPayload = {
  providers: ProviderItem[];
  defaultModels: Record<ModelTaskType, DefaultModelItem>;
};

type ProviderFormState = {
  key: string;
  label: string;
  providerName: string;
  modelName: string;
  baseUrl: string;
  apiKey: string;
  hasStoredApiKey: boolean;
  clearStoredApiKey: boolean;
  timeoutMs: string;
  maxRetries: string;
  enabled: boolean;
  defaultForTasks: ModelTaskType[];
};

type JsonWithError = { error?: string };

function isProviderPayload(
  payload: ProviderPayload | JsonWithError | null,
): payload is ProviderPayload {
  return Boolean(
    payload &&
      "providers" in payload &&
      Array.isArray(payload.providers) &&
      "defaultModels" in payload,
  );
}

const taskOptions: Array<{ value: ModelTaskType; label: string }> = [
  { value: "script_question_generate", label: "脚本问答" },
  { value: "script_finalize", label: "脚本定稿" },
  { value: "storyboard_split", label: "分镜拆解" },
  { value: "image_generate", label: "图片生成" },
  { value: "image_edit", label: "图片编辑" },
  { value: "video_generate", label: "视频生成" },
];

function createEmptyFormState(): ProviderFormState {
  return {
    key: "",
    label: "",
    providerName: "",
    modelName: "",
    baseUrl: "",
    apiKey: "",
    hasStoredApiKey: false,
    clearStoredApiKey: false,
    timeoutMs: "30000",
    maxRetries: "2",
    enabled: true,
    defaultForTasks: [],
  };
}

function toFormState(provider: ProviderItem): ProviderFormState {
  return {
    key: provider.key,
    label: provider.label,
    providerName: provider.providerName,
    modelName: provider.modelName ?? "",
    baseUrl: provider.baseUrl ?? "",
    apiKey: "",
    hasStoredApiKey: provider.apiKeyMaskedTail !== null,
    clearStoredApiKey: false,
    timeoutMs: String(provider.timeoutMs),
    maxRetries: String(provider.maxRetries),
    enabled: provider.enabled,
    defaultForTasks: provider.configJson.defaultForTasks ?? [],
  };
}

function getStoredSecretSummary(providers: ProviderItem[], selectedKey: string | null) {
  if (!selectedKey) {
    return "已存储";
  }

  return providers.find((provider) => provider.key === selectedKey)?.apiKeyMaskedTail ?? "已存储";
}

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function requestSafe(url: string, init?: RequestInit) {
  try {
    const response = await fetch(url, init);
    return { response };
  } catch {
    throw new Error("网络请求失败");
  }
}

export default function AdminProvidersPage() {
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [defaultModels, setDefaultModels] = useState<Record<ModelTaskType, DefaultModelItem> | null>(null);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [form, setForm] = useState<ProviderFormState>(createEmptyFormState());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchAdminData(): Promise<ProviderPayload> {
    const { response } = await requestSafe("/api/admin/providers", { cache: "no-store" });
    const payload = await parseJsonSafe<ProviderPayload | JsonWithError>(response);

    if (!response.ok) {
      if (payload && "error" in payload) {
        throw new Error(payload.error ?? "加载提供方失败");
      }

      throw new Error("加载提供方失败");
    }

    if (!isProviderPayload(payload)) {
      throw new Error("加载提供方失败");
    }

    return payload;
  }

  async function loadData() {
    const payload = await fetchAdminData();
    setProviders(payload.providers);
    setDefaultModels(payload.defaultModels);

    if (mode === "edit" && selectedKey) {
      const selectedProvider = payload.providers.find((provider) => provider.key === selectedKey);

      if (selectedProvider) {
        setForm(toFormState(selectedProvider));
      }
    }
  }

  async function safeRefreshAfterMutation() {
    try {
      await loadData();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "操作成功，但列表刷新失败");
    }
  }

  useEffect(() => {
    let isActive = true;

    async function runInitialLoad() {
      try {
        const payload = await fetchAdminData();

        if (!isActive) {
          return;
        }

        setProviders(payload.providers);
        setDefaultModels(payload.defaultModels);
      } catch (loadError) {
        if (!isActive) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "加载提供方失败");
      }
    }

    void runInitialLoad();

    return () => {
      isActive = false;
    };
  }, []);

  function updateForm<K extends keyof ProviderFormState>(key: K, value: ProviderFormState[K]) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function selectProvider(provider: ProviderItem) {
    setMode("edit");
    setSelectedKey(provider.key);
    setForm(toFormState(provider));
    setMessage(null);
    setError(null);
  }

  function startCreateMode() {
    setMode("create");
    setSelectedKey(null);
    setForm(createEmptyFormState());
    setMessage(null);
    setError(null);
  }

  function toggleTask(taskType: ModelTaskType) {
    setForm((current) => ({
      ...current,
      defaultForTasks: current.defaultForTasks.includes(taskType)
        ? current.defaultForTasks.filter((value) => value !== taskType)
        : [...current.defaultForTasks, taskType],
    }));
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    try {
      const { response } = await requestSafe("/api/admin/providers", {
        method: mode === "create" ? "POST" : "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          key: form.key,
          label: form.label,
          providerName: form.providerName,
          modelName: form.modelName,
          baseUrl: form.baseUrl,
          timeoutMs: Number(form.timeoutMs),
          maxRetries: Number(form.maxRetries),
          enabled: form.enabled,
          configJson: {
            defaultForTasks: form.defaultForTasks,
          },
          ...(mode === "create"
            ? { apiKey: form.apiKey }
            : form.clearStoredApiKey
              ? { apiKey: null }
              : form.apiKey.trim().length > 0
                ? { apiKey: form.apiKey }
                : {}),
        }),
      });
      const payload = await parseJsonSafe<JsonWithError>(response);

      if (!response.ok) {
        setError(payload?.error ?? "保存提供方失败");
        return;
      }

      setMessage(mode === "create" ? "提供方已创建。" : "提供方已更新。");
      await safeRefreshAfterMutation();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存提供方失败");
    }
  }

  return (
    <section style={pageStyle}>
      <header style={headerStyle}>
        <p style={eyebrowStyle}>模型提供方</p>
        <h2 style={titleStyle}>模型提供方</h2>
        <p style={copyStyle}>统一维护代理地址、密钥、超时重试与任务默认路由。</p>
      </header>

      {message ? (
        <p style={messageStyle} role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
      {error ? (
        <p style={errorStyle} role="alert" aria-live="assertive">
          {error}
        </p>
      ) : null}

      <section style={panelStyle}>
        <h3 style={panelTitleStyle}>默认模型路由</h3>
        <p style={copyStyle}>每个任务类型都从此处解析默认提供方。</p>
        <div style={summaryGridStyle}>
          {taskOptions.map((task) => {
            const summary = defaultModels?.[task.value] ?? null;

            return (
              <article key={task.value} style={summaryCardStyle}>
                <strong>{task.label}</strong>
                <p style={metaStyle}>{summary ? `${summary.providerKey} / ${summary.model ?? "-"}` : "未配置"}</p>
                <p style={metaStyle}>{summary ? summary.providerName : "无可用提供方"}</p>
              </article>
            );
          })}
        </div>
      </section>

      <div style={gridStyle}>
        <section style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h3 style={panelTitleStyle}>{mode === "create" ? "创建提供方" : "编辑提供方"}</h3>
              <p style={copyStyle}>
                {mode === "create"
                  ? "新增一个可用于任务路由的提供方配置。"
                  : `正在编辑 ${selectedKey ?? "提供方"}。`}
              </p>
            </div>
            {mode === "edit" ? (
              <button type="button" style={secondaryButtonStyle} onClick={startCreateMode}>
                新建提供方
              </button>
            ) : null}
          </div>

          <form onSubmit={submitForm} style={formStyle}>
            <label style={fieldStyle}>
              <span>Key</span>
              <input
                value={form.key}
                onChange={(event) => updateForm("key", event.target.value)}
                style={inputStyle}
                disabled={mode === "edit"}
              />
            </label>
            <label style={fieldStyle}>
              <span>名称</span>
              <input
                value={form.label}
                onChange={(event) => updateForm("label", event.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span>Provider Name</span>
              <input
                value={form.providerName}
                onChange={(event) => updateForm("providerName", event.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span>Model</span>
              <input
                value={form.modelName}
                onChange={(event) => updateForm("modelName", event.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span>Base URL</span>
              <input
                value={form.baseUrl}
                onChange={(event) => updateForm("baseUrl", event.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span>API Key</span>
              {mode === "edit" ? (
                <span style={hintStyle}>
                  {form.hasStoredApiKey
                    ? `当前密钥尾号 ${getStoredSecretSummary(providers, selectedKey)}。留空表示保持不变，填写新值表示替换。`
                    : "尚未存储密钥，填写后可立即生效。"}
                </span>
              ) : null}
              <input
                value={form.apiKey}
                onChange={(event) => updateForm("apiKey", event.target.value)}
                style={inputStyle}
                placeholder={mode === "edit" && form.hasStoredApiKey ? "输入新 API Key 以替换" : "输入 API Key"}
                disabled={mode === "edit" && form.clearStoredApiKey}
              />
            </label>
            {mode === "edit" && form.hasStoredApiKey ? (
              <label style={checkboxLabelStyle}>
                <input
                  type="checkbox"
                  checked={form.clearStoredApiKey}
                  onChange={(event) => updateForm("clearStoredApiKey", event.target.checked)}
                />
                <span>清空已存储密钥</span>
              </label>
            ) : null}
            <div style={compactGridStyle}>
              <label style={fieldStyle}>
                <span>Timeout (ms)</span>
                <input
                  value={form.timeoutMs}
                  onChange={(event) => updateForm("timeoutMs", event.target.value)}
                  style={inputStyle}
                  inputMode="numeric"
                />
              </label>
              <label style={fieldStyle}>
                <span>Max Retries</span>
                <input
                  value={form.maxRetries}
                  onChange={(event) => updateForm("maxRetries", event.target.value)}
                  style={inputStyle}
                  inputMode="numeric"
                />
              </label>
            </div>
            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => updateForm("enabled", event.target.checked)}
              />
              <span>启用</span>
            </label>
            <fieldset style={fieldsetStyle}>
              <legend style={legendStyle}>默认任务</legend>
              <div style={taskListStyle}>
                {taskOptions.map((task) => (
                  <label key={task.value} style={taskCheckboxStyle}>
                    <input
                      type="checkbox"
                      checked={form.defaultForTasks.includes(task.value)}
                      onChange={() => toggleTask(task.value)}
                    />
                    <span>{task.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <button type="submit" style={primaryButtonStyle}>
              {mode === "create" ? "创建提供方" : "保存变更"}
            </button>
          </form>
        </section>

        <section style={panelStyle}>
          <h3 style={panelTitleStyle}>已注册提供方</h3>
          <p style={copyStyle}>点击条目进入编辑，变更会复用同一组接口语义。</p>
          <div style={listStyle}>
            {providers.length === 0 ? <p style={copyStyle}>暂无提供方。</p> : null}
            {providers.map((provider) => (
              <article key={provider.id} style={itemStyle}>
                <div style={itemContentStyle}>
                  <div style={itemTitleRowStyle}>
                    <strong>{provider.label}</strong>
                    <StatusBadge
                      label={provider.enabled ? "已启用" : "已停用"}
                      tone={provider.enabled ? "success" : "danger"}
                    />
                  </div>
                  <p style={metaStyle}>
                    {provider.key} / {provider.providerName} / {provider.modelName ?? "-"}
                  </p>
                  <p style={metaStyle}>
                    {provider.timeoutMs} ms / {provider.maxRetries} 次重试
                  </p>
                </div>
                <button type="button" onClick={() => selectProvider(provider)} style={secondaryButtonStyle}>
                  编辑
                </button>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

const pageStyle = {
  display: "grid",
  gap: "20px",
} satisfies CSSProperties;

const headerStyle = {
  display: "grid",
  gap: "8px",
} satisfies CSSProperties;

const eyebrowStyle = {
  margin: 0,
  color: "var(--accent-gold)",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  fontSize: "0.78rem",
} satisfies CSSProperties;

const titleStyle = {
  margin: 0,
  fontSize: "1.85rem",
  lineHeight: 1.2,
} satisfies CSSProperties;

const copyStyle = {
  margin: 0,
  color: "var(--text-muted)",
  lineHeight: 1.6,
} satisfies CSSProperties;

const gridStyle = {
  display: "grid",
  gap: "16px",
  gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.8fr)",
} satisfies CSSProperties;

const panelStyle = {
  borderRadius: "20px",
  border: "1px solid var(--border)",
  background: "rgba(22, 24, 39, 0.82)",
  padding: "18px",
} satisfies CSSProperties;

const sectionHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "10px",
  alignItems: "center",
} satisfies CSSProperties;

const panelTitleStyle = {
  margin: 0,
  fontSize: "1.06rem",
} satisfies CSSProperties;

const summaryGridStyle = {
  display: "grid",
  gap: "10px",
  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
  marginTop: "14px",
} satisfies CSSProperties;

const summaryCardStyle = {
  borderRadius: "14px",
  padding: "14px",
  border: "1px solid var(--border)",
  background: "rgba(15, 15, 35, 0.56)",
} satisfies CSSProperties;

const formStyle = {
  display: "grid",
  gap: "12px",
  marginTop: "14px",
} satisfies CSSProperties;

const compactGridStyle = {
  display: "grid",
  gap: "12px",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
} satisfies CSSProperties;

const fieldStyle = {
  display: "grid",
  gap: "8px",
  fontWeight: 600,
} satisfies CSSProperties;

const inputStyle = {
  width: "100%",
  borderRadius: "12px",
  border: "1px solid var(--border)",
  padding: "10px 12px",
  font: "inherit",
  background: "rgba(15, 15, 35, 0.72)",
  color: "var(--text)",
} satisfies CSSProperties;

const hintStyle = {
  color: "var(--text-muted)",
  fontWeight: 400,
  fontSize: "0.9rem",
  lineHeight: 1.5,
} satisfies CSSProperties;

const checkboxLabelStyle = {
  display: "flex",
  gap: "10px",
  alignItems: "center",
  fontWeight: 600,
} satisfies CSSProperties;

const fieldsetStyle = {
  borderRadius: "14px",
  border: "1px solid var(--border)",
  padding: "12px",
} satisfies CSSProperties;

const legendStyle = {
  padding: "0 6px",
  fontWeight: 700,
} satisfies CSSProperties;

const taskListStyle = {
  display: "grid",
  gap: "10px",
} satisfies CSSProperties;

const taskCheckboxStyle = {
  display: "flex",
  gap: "10px",
  alignItems: "center",
} satisfies CSSProperties;

const listStyle = {
  display: "grid",
  gap: "10px",
  marginTop: "14px",
} satisfies CSSProperties;

const itemStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: "10px",
  alignItems: "center",
  padding: "12px",
  borderRadius: "14px",
  border: "1px solid var(--border)",
  background: "rgba(15, 15, 35, 0.56)",
} satisfies CSSProperties;

const itemContentStyle = {
  display: "grid",
  gap: "6px",
} satisfies CSSProperties;

const itemTitleRowStyle = {
  display: "flex",
  gap: "8px",
  alignItems: "center",
  flexWrap: "wrap",
} satisfies CSSProperties;

const metaStyle = {
  margin: 0,
  color: "var(--text-muted)",
  fontSize: "0.92rem",
} satisfies CSSProperties;

const baseButtonStyle = {
  border: "1px solid transparent",
  borderRadius: "999px",
  padding: "8px 12px",
  font: "inherit",
  fontWeight: 700,
  cursor: "pointer",
} satisfies CSSProperties;

const primaryButtonStyle = {
  ...baseButtonStyle,
  background: "var(--accent-violet)",
  color: "var(--text)",
} satisfies CSSProperties;

const secondaryButtonStyle = {
  ...baseButtonStyle,
  background: "rgba(248, 250, 252, 0.08)",
  borderColor: "var(--border)",
  color: "var(--text)",
} satisfies CSSProperties;

const messageStyle = {
  margin: 0,
  padding: "12px 14px",
  borderRadius: "14px",
  border: "1px solid var(--border)",
  background: "rgba(109, 94, 252, 0.2)",
  color: "var(--text)",
} satisfies CSSProperties;

const errorStyle = {
  margin: 0,
  padding: "12px 14px",
  borderRadius: "14px",
  border: "1px solid var(--border)",
  background: "rgba(248, 113, 113, 0.2)",
  color: "var(--text)",
} satisfies CSSProperties;
