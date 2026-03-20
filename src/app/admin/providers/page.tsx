"use client";

import type { CSSProperties, FormEvent } from "react";
import { useEffect, useState } from "react";
import type { ModelTaskType } from "@/lib/models/contracts";

type ProviderItem = {
  id: string;
  key: string;
  label: string;
  providerName: string;
  modelName: string | null;
  baseUrl: string | null;
  apiKey: string | null;
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
  timeoutMs: string;
  maxRetries: string;
  enabled: boolean;
  defaultForTasks: ModelTaskType[];
};

const taskOptions: Array<{ value: ModelTaskType; label: string }> = [
  { value: "script_question_generate", label: "Script Question Generate" },
  { value: "script_finalize", label: "Script Finalize" },
  { value: "storyboard_split", label: "Storyboard Split" },
  { value: "image_generate", label: "Image Generate" },
  { value: "image_edit", label: "Image Edit" },
  { value: "video_generate", label: "Video Generate" },
];

function createEmptyFormState(): ProviderFormState {
  return {
    key: "",
    label: "",
    providerName: "",
    modelName: "",
    baseUrl: "",
    apiKey: "",
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
    apiKey: provider.apiKey ?? "",
    timeoutMs: String(provider.timeoutMs),
    maxRetries: String(provider.maxRetries),
    enabled: provider.enabled,
    defaultForTasks: provider.configJson.defaultForTasks ?? [],
  };
}

export default function AdminProvidersPage() {
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [defaultModels, setDefaultModels] = useState<Record<ModelTaskType, DefaultModelItem> | null>(null);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [form, setForm] = useState<ProviderFormState>(createEmptyFormState());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchAdminData() {
    const response = await fetch("/api/admin/providers", { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as
      | ProviderPayload
      | { error?: string }
      | null;

    if (!response.ok) {
      if (payload && "error" in payload) {
        throw new Error(payload.error ?? "Failed to load providers");
      }

      throw new Error("Failed to load providers");
    }

    return payload as ProviderPayload;
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

        setError(loadError instanceof Error ? loadError.message : "Failed to load providers");
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

    const response = await fetch("/api/admin/providers", {
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
        apiKey: form.apiKey,
        timeoutMs: Number(form.timeoutMs),
        maxRetries: Number(form.maxRetries),
        enabled: form.enabled,
        configJson: {
          defaultForTasks: form.defaultForTasks,
        },
      }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Failed to save provider");
      return;
    }

    setMessage(mode === "create" ? "Provider created." : "Provider updated.");
    await loadData();
  }

  return (
    <section style={pageStyle}>
      <header>
        <p style={eyebrowStyle}>Providers</p>
        <h2 style={titleStyle}>Model Provider Registry</h2>
        <p style={copyStyle}>
          Manage proxy endpoints, credentials, and default model assignments for each generation pipeline.
        </p>
      </header>

      {message ? <p style={messageStyle}>{message}</p> : null}
      {error ? <p style={errorStyle}>{error}</p> : null}

      <section style={panelStyle}>
        <h3 style={panelTitleStyle}>Default Models</h3>
        <p style={copyStyle}>Each business task resolves through the shared provider registry.</p>
        <div style={summaryGridStyle}>
          {taskOptions.map((task) => {
            const summary = defaultModels?.[task.value] ?? null;

            return (
              <article key={task.value} style={summaryCardStyle}>
                <strong>{task.label}</strong>
                <p style={metaStyle}>{summary ? `${summary.providerKey} / ${summary.model ?? "-"}` : "Not configured"}</p>
                <p style={metaStyle}>{summary ? summary.providerName : "No enabled provider"}</p>
              </article>
            );
          })}
        </div>
      </section>

      <div style={gridStyle}>
        <section style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h3 style={panelTitleStyle}>{mode === "create" ? "Create Provider" : "Edit Provider"}</h3>
              <p style={copyStyle}>
                {mode === "create"
                  ? "Add a new provider profile for one or more pipelines."
                  : `Editing ${selectedKey ?? "provider"}.`}
              </p>
            </div>
            {mode === "edit" ? (
              <button type="button" style={secondaryButtonStyle} onClick={startCreateMode}>
                New Provider
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
              <span>Label</span>
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
              <input
                value={form.apiKey}
                onChange={(event) => updateForm("apiKey", event.target.value)}
                style={inputStyle}
              />
            </label>
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
              <span>Enabled</span>
            </label>
            <fieldset style={fieldsetStyle}>
              <legend style={legendStyle}>Default Tasks</legend>
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
            <button type="submit" style={buttonStyle}>
              {mode === "create" ? "Create Provider" : "Save Changes"}
            </button>
          </form>
        </section>

        <section style={panelStyle}>
          <h3 style={panelTitleStyle}>Registered Providers</h3>
          <p style={copyStyle}>Select a provider to edit its proxy settings and task defaults.</p>
          <div style={listStyle}>
            {providers.length === 0 ? <p style={copyStyle}>No providers found.</p> : null}
            {providers.map((provider) => (
              <article key={provider.id} style={itemStyle}>
                <div>
                  <strong>{provider.label}</strong>
                  <p style={metaStyle}>
                    {provider.key} / {provider.providerName} / {provider.modelName ?? "-"}
                  </p>
                  <p style={metaStyle}>
                    {provider.enabled ? "Enabled" : "Disabled"} / {provider.timeoutMs} ms / {provider.maxRetries} retries
                  </p>
                </div>
                <button type="button" onClick={() => selectProvider(provider)} style={buttonStyle}>
                  Edit
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

const eyebrowStyle = {
  margin: 0,
  color: "#8c5f2d",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  fontSize: "0.8rem",
} satisfies CSSProperties;

const titleStyle = {
  margin: "10px 0 0",
  fontSize: "2rem",
} satisfies CSSProperties;

const copyStyle = {
  margin: "10px 0 0",
  color: "#665d52",
  lineHeight: 1.6,
} satisfies CSSProperties;

const gridStyle = {
  display: "grid",
  gap: "20px",
  gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.8fr)",
} satisfies CSSProperties;

const panelStyle = {
  borderRadius: "24px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
  background: "rgba(255, 250, 243, 0.94)",
  padding: "20px",
} satisfies CSSProperties;

const sectionHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "center",
} satisfies CSSProperties;

const panelTitleStyle = {
  margin: 0,
  fontSize: "1.2rem",
} satisfies CSSProperties;

const summaryGridStyle = {
  display: "grid",
  gap: "12px",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  marginTop: "16px",
} satisfies CSSProperties;

const summaryCardStyle = {
  borderRadius: "18px",
  padding: "16px",
  background: "rgba(140, 95, 45, 0.06)",
} satisfies CSSProperties;

const formStyle = {
  display: "grid",
  gap: "12px",
  marginTop: "16px",
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
  borderRadius: "14px",
  border: "1px solid rgba(31, 27, 22, 0.16)",
  padding: "12px 14px",
  font: "inherit",
  background: "#fff",
} satisfies CSSProperties;

const checkboxLabelStyle = {
  display: "flex",
  gap: "10px",
  alignItems: "center",
  fontWeight: 600,
} satisfies CSSProperties;

const fieldsetStyle = {
  borderRadius: "18px",
  border: "1px solid rgba(31, 27, 22, 0.12)",
  padding: "12px 14px",
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
  gap: "12px",
  marginTop: "16px",
} satisfies CSSProperties;

const itemStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "center",
  padding: "14px",
  borderRadius: "18px",
  background: "rgba(140, 95, 45, 0.06)",
} satisfies CSSProperties;

const metaStyle = {
  margin: "6px 0 0",
  color: "#665d52",
} satisfies CSSProperties;

const buttonStyle = {
  border: 0,
  borderRadius: "999px",
  background: "#8c5f2d",
  color: "#fff",
  padding: "10px 14px",
  font: "inherit",
  fontWeight: 700,
  cursor: "pointer",
} satisfies CSSProperties;

const secondaryButtonStyle = {
  ...buttonStyle,
  background: "#f0e3d1",
  color: "#4b3a27",
} satisfies CSSProperties;

const messageStyle = {
  margin: 0,
  padding: "14px 16px",
  borderRadius: "16px",
  background: "rgba(23, 92, 49, 0.12)",
  color: "#175c31",
} satisfies CSSProperties;

const errorStyle = {
  margin: 0,
  padding: "14px 16px",
  borderRadius: "16px",
  background: "rgba(180, 35, 24, 0.12)",
  color: "#b42318",
} satisfies CSSProperties;
