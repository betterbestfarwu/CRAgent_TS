import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CONTEXT_CONFIG, mergeContextConfig } from "@shared/contextConfig";
import { ensureMcpConfigShape } from "@shared/mcpConfig.js";
import { DEFAULT_UI_CONFIG, mergeUiConfig } from "@shared/uiConfig.js";
import { validateProviderConnectionFields } from "@shared/providerConnection.js";
import { ConfirmDialog } from "./ConfirmDialog.jsx";
import { withConfigFileLinks } from "./ConfigFileLink.jsx";
import { SingleDotIcon } from "./DotGridAnimator.jsx";
import { McpSettingsTab } from "./McpSettingsTab.jsx";

const ICON_EYE = (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const ICON_REFRESH = (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
  </svg>
);

const ICON_TRASH = (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const ICON_EYE_OFF = (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
    <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.746 10.746 0 0 1-1.444 2.49" />
    <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
    <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
    <path d="m2 2 20 20" />
  </svg>
);

const ICON_PLUS = (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="12" y1="3" x2="12" y2="21" />
    <line x1="3" y1="12" x2="21" y2="12" />
  </svg>
);

const ICON_EDIT = (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

function createEmptyProvider() {
  return {
    baseUrl: "",
    apiKey: "",
    api: "chat/completions",
    state: true,
    models: [],
  };
}

function replaceProviderRef(ref, oldKey, newKey) {
  const prefix = `${oldKey}/`;
  if (typeof ref === "string" && ref.startsWith(prefix)) {
    return `${newKey}/${ref.slice(prefix.length)}`;
  }
  return ref;
}

function modelRefUsesProvider(ref, providerKey) {
  return typeof ref === "string" && ref.startsWith(`${providerKey}/`);
}

function firstModelRef(models) {
  for (const [providerKey, provider] of Object.entries(models || {})) {
    for (const model of provider.models || []) {
      if (model.state) return `${providerKey}/${model.id}`;
    }
  }
  for (const [providerKey, provider] of Object.entries(models || {})) {
    const first = provider.models?.[0];
    if (first) return `${providerKey}/${first.id}`;
  }
  return "";
}

function ProviderNameDialog({ title, initialName = "", onClose, onConfirm }) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function handleSubmit(event) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  }

  return (
    <div className="confirm-overlay" role="presentation">
      <form
        className="confirm-dialog provider-name-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-name-dialog-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div id="provider-name-dialog-title" className="confirm-dialog-title">
          {title}
        </div>
        <input
          ref={inputRef}
          className="provider-name-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Provider 名称"
          aria-label="Provider 名称"
        />
        <div className="confirm-dialog-actions">
          <button type="button" className="confirm-dialog-btn" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="confirm-dialog-btn confirm-dialog-btn-primary">
            保存
          </button>
        </div>
      </form>
    </div>
  );
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureUiConfigShape(config) {
  return {
    ...config,
    ui: mergeUiConfig(config?.ui),
  };
}

function SettingsGroup({ label, children, footer, cardClassName = "", className = "" }) {
  return (
    <section className={`settings-group${className ? ` ${className}` : ""}`}>
      {label ? <h3 className="settings-group-label">{label}</h3> : null}
      <div className={`settings-group-card${cardClassName ? ` ${cardClassName}` : ""}`}>
        {children}
      </div>
      {footer ? <p className="settings-group-footer">{footer}</p> : null}
    </section>
  );
}

function SettingsToggleRow({ title, description, checked, onChange }) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <div className="settings-row-title">{title}</div>
        {description ? <div className="settings-row-description">{description}</div> : null}
      </div>
      <label className="settings-switch" aria-label={title}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="settings-switch-slider" aria-hidden="true" />
      </label>
    </div>
  );
}

function SettingsNumberRow({ title, description, value, min, max, step = 1, onChange }) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <div className="settings-row-title">{title}</div>
        {description ? <div className="settings-row-description">{description}</div> : null}
      </div>
      <input
        className="settings-row-number"
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={title}
      />
    </div>
  );
}

function SettingsSelectRow({ title, description, value, onChange, children }) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <div className="settings-row-title">{title}</div>
        {description ? <div className="settings-row-description">{description}</div> : null}
      </div>
      <select
        className="settings-row-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={title}
      >
        {children}
      </select>
    </div>
  );
}

function SettingsTextRow({
  title,
  description,
  value,
  onChange,
  type = "text",
  action = null,
  error = "",
}) {
  return (
    <div className="settings-row settings-row-field">
      <div className="settings-row-copy">
        <div className="settings-row-title">{title}</div>
        {description ? <div className="settings-row-description">{description}</div> : null}
      </div>
      <div className="settings-row-input-column">
        <div className={`settings-row-input-wrap${action ? " has-action" : ""}`}>
          <input
            className="settings-row-text"
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={title}
          />
          {action}
        </div>
        {error ? <p className="settings-field-error">{error}</p> : null}
      </div>
    </div>
  );
}

function SettingsModelRow({ title, checked, onToggle, onDelete }) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <div className="settings-row-title settings-row-title-mono">{title}</div>
      </div>
      <div className="settings-row-actions">
        <label className="settings-switch" aria-label={`Enable ${title}`}>
          <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
          <span className="settings-switch-slider" aria-hidden="true" />
        </label>
        <button
          type="button"
          className="settings-row-icon-btn"
          title={`删除 ${title}`}
          aria-label={`删除 ${title}`}
          onClick={onDelete}
        >
          {ICON_TRASH}
        </button>
      </div>
    </div>
  );
}

export function SettingsPage({ config, onBack, onSave, onSyncProviderModels, onProbeMcp }) {
  const [activeTab, setActiveTab] = useState("models");
  const [draftConfig, setDraftConfig] = useState(() =>
    ensureUiConfigShape(ensureMcpConfigShape(clone(config))),
  );
  const [modelSearch, setModelSearch] = useState("");
  const [modelStateFilter, setModelStateFilter] = useState("all");
  const [showApiKey, setShowApiKey] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [providerSyncErrors, setProviderSyncErrors] = useState({});
  const [providerDialog, setProviderDialog] = useState(null);
  const [deleteProviderConfirmOpen, setDeleteProviderConfirmOpen] = useState(false);
  const modelsPanelRef = useRef(null);
  const providerKeys = useMemo(
    () => Object.keys(draftConfig.models || {}),
    [draftConfig.models],
  );
  const [selectedProviderKey, setSelectedProviderKey] = useState(
    providerKeys[0] || "",
  );

  useEffect(() => {
    const next = ensureUiConfigShape(ensureMcpConfigShape(clone(config)));
    setDraftConfig(next);
    const keys = Object.keys(next.models || {});
    setSelectedProviderKey((prev) =>
      prev && keys.includes(prev) ? prev : keys[0] || "",
    );
  }, [config]);

  const selectedProvider = selectedProviderKey
    ? draftConfig.models?.[selectedProviderKey]
    : null;
  const selectedProviderSyncError = selectedProviderKey
    ? providerSyncErrors[selectedProviderKey] || ""
    : "";

  function setProviderSyncError(providerKey, message) {
    if (!providerKey) return;
    setProviderSyncErrors((prev) => {
      if (!message) {
        if (!(providerKey in prev)) return prev;
        const next = { ...prev };
        delete next[providerKey];
        return next;
      }
      return { ...prev, [providerKey]: message };
    });
  }

  const filteredModels = useMemo(() => {
    const models = selectedProvider?.models || [];
    const keyword = modelSearch.trim().toLowerCase();
    return models.filter((model) => {
      const matchedKeyword = !keyword || model.id.toLowerCase().includes(keyword);
      if (!matchedKeyword) return false;
      if (modelStateFilter === "selected") return Boolean(model.state);
      if (modelStateFilter === "unselected") return !model.state;
      return true;
    });
  }, [selectedProvider, modelSearch, modelStateFilter]);
  useEffect(() => {
    modelsPanelRef.current?.scrollTo({ top: 0 });
  }, [selectedProviderKey, modelSearch, modelStateFilter]);
  const enabledModelRefs = useMemo(
    () =>
      Object.entries(draftConfig.models || {}).flatMap(([providerKey, provider]) =>
        (provider.models || [])
          .filter((model) => model.state)
          .map((model) => `${providerKey}/${model.id}`),
      ),
    [draftConfig.models],
  );
  const defaultAgentConfig = draftConfig.agents?.default || {};
  const defaultAgentListItem =
    draftConfig.agents?.list?.find((item) => item.is_default) ||
    draftConfig.agents?.list?.[0] ||
    null;
  const contextDraft = useMemo(
    () => mergeContextConfig(draftConfig.context),
    [draftConfig.context],
  );
  const uiDraft = useMemo(() => mergeUiConfig(draftConfig.ui), [draftConfig.ui]);

  function updateUi(patch) {
    setDraftConfig((prev) => ({
      ...prev,
      ui: mergeUiConfig({ ...prev.ui, ...patch }),
    }));
  }

  function updateUiNumber(key, rawValue, { min = 0, max = Infinity, fallback = 0 } = {}) {
    const parsed = Number.parseInt(String(rawValue), 10);
    const value = Number.isFinite(parsed) ? Math.max(min, parsed) : fallback;
    updateUi({ [key]: Number.isFinite(max) ? Math.min(max, value) : value });
  }

  function updateContext(patch) {
    setDraftConfig((prev) => ({
      ...prev,
      context: mergeContextConfig({ ...prev.context, ...patch }),
    }));
  }

  function updateContextNumber(key, rawValue, { min = 0, max = Infinity, fallback = 0 } = {}) {
    const parsed = Number.parseInt(String(rawValue), 10);
    const value = Number.isFinite(parsed) ? Math.max(min, parsed) : fallback;
    updateContext({ [key]: Number.isFinite(max) ? Math.min(max, value) : value });
  }

  function updateProvider(patch) {
    if (!selectedProviderKey) return;
    setDraftConfig((prev) => ({
      ...prev,
      models: {
        ...prev.models,
        [selectedProviderKey]: {
          ...prev.models[selectedProviderKey],
          ...patch,
        },
      },
    }));
  }

  function addProvider(providerKey) {
    if (draftConfig.models?.[providerKey]) {
      setProviderSyncError(selectedProviderKey, `Provider「${providerKey}」已存在。`);
      return;
    }
    setProviderSyncError(selectedProviderKey, "");
    setDraftConfig((prev) => ({
      ...prev,
      models: {
        ...prev.models,
        [providerKey]: createEmptyProvider(),
      },
    }));
    setSelectedProviderKey(providerKey);
    setProviderDialog(null);
  }

  function renameProvider(nextProviderKey) {
    if (!selectedProviderKey) return;
    if (nextProviderKey === selectedProviderKey) {
      setProviderDialog(null);
      return;
    }
    if (draftConfig.models?.[nextProviderKey]) {
      setProviderSyncError(selectedProviderKey, `Provider「${nextProviderKey}」已存在。`);
      return;
    }
    setProviderSyncError(selectedProviderKey, "");
    setProviderSyncErrors((prev) => {
      const next = { ...prev };
      if (selectedProviderKey in next) {
        next[nextProviderKey] = next[selectedProviderKey];
        delete next[selectedProviderKey];
      }
      return next;
    });
    setDraftConfig((prev) => {
      const provider = prev.models[selectedProviderKey];
      const { [selectedProviderKey]: _removed, ...restModels } = prev.models;
      const defaultModel = prev.agents?.default?.model || {};
      return {
        ...prev,
        models: {
          ...restModels,
          [nextProviderKey]: provider,
        },
        agents: {
          ...prev.agents,
          default: {
            ...prev.agents.default,
            model: {
              ...defaultModel,
              primary: replaceProviderRef(defaultModel.primary, selectedProviderKey, nextProviderKey),
              fallbacks: (defaultModel.fallbacks || []).map((ref) =>
                replaceProviderRef(ref, selectedProviderKey, nextProviderKey),
              ),
            },
          },
        },
      };
    });
    setSelectedProviderKey(nextProviderKey);
    setProviderDialog(null);
  }

  function deleteProvider() {
    if (!selectedProviderKey) return;
    const keyToDelete = selectedProviderKey;
    const remainingKeys = providerKeys.filter((key) => key !== keyToDelete);
    setProviderSyncError(keyToDelete, "");
    setDraftConfig((prev) => {
      const { [keyToDelete]: _removed, ...restModels } = prev.models;
      const defaultModel = prev.agents?.default?.model || {};
      let nextPrimary = defaultModel.primary || "";
      if (modelRefUsesProvider(nextPrimary, keyToDelete)) {
        nextPrimary = firstModelRef(restModels);
      }
      const nextFallbacks = (defaultModel.fallbacks || []).filter(
        (ref) => !modelRefUsesProvider(ref, keyToDelete),
      );
      return {
        ...prev,
        models: restModels,
        agents: {
          ...prev.agents,
          default: {
            ...prev.agents.default,
            model: {
              ...defaultModel,
              primary: nextPrimary,
              fallbacks: nextFallbacks,
            },
          },
        },
      };
    });
    setSelectedProviderKey(remainingKeys[0] || "");
  }

  function updateModelState(modelId, checked) {
    if (!selectedProviderKey) return;
    setDraftConfig((prev) => {
      const provider = prev.models[selectedProviderKey];
      return {
        ...prev,
        models: {
          ...prev.models,
          [selectedProviderKey]: {
            ...provider,
            models: provider.models.map((model) =>
              model.id === modelId ? { ...model, state: checked } : model,
            ),
          },
        },
      };
    });
  }

  function deleteModel(modelId) {
    if (!selectedProviderKey || !modelId) return;
    setDraftConfig((prev) => {
      const provider = prev.models[selectedProviderKey];
      return {
        ...prev,
        models: {
          ...prev.models,
          [selectedProviderKey]: {
            ...provider,
            models: provider.models.filter((model) => model.id !== modelId),
          },
        },
      };
    });
  }

  function handleSave() {
    void onSave(ensureMcpConfigShape(draftConfig));
  }

  async function handleSyncModels() {
    const providerKey = selectedProviderKey;
    if (!providerKey || !onSyncProviderModels || !selectedProvider) {
      setProviderSyncError(providerKey, "模型同步功能未就绪，请重启应用。");
      return;
    }
    const connection = {
      baseUrl: selectedProvider.baseUrl ?? "",
      apiKey: selectedProvider.apiKey ?? "",
      api: selectedProvider.api ?? "",
    };
    const validation = validateProviderConnectionFields(connection);
    if (!validation.ok) {
      setProviderSyncError(providerKey, validation.error);
      return;
    }
    setSyncLoading(true);
    setProviderSyncError(providerKey, "");
    try {
      const result = await onSyncProviderModels(providerKey, connection);
      setDraftConfig(clone(result.config));
    } catch (err) {
      setProviderSyncError(providerKey, err instanceof Error ? err.message : String(err));
    } finally {
      setSyncLoading(false);
    }
  }

  function updateDefaultAgentModel(patch) {
    setDraftConfig((prev) => ({
      ...prev,
      agents: {
        ...prev.agents,
        default: {
          ...prev.agents.default,
          model: {
            ...prev.agents.default.model,
            ...patch,
          },
        },
      },
    }));
  }

  function updateDefaultExecutionMode(mode) {
    setDraftConfig((prev) => ({
      ...prev,
      agents: {
        ...prev.agents,
        default: {
          ...prev.agents.default,
          execution_mode: mode,
        },
      },
    }));
  }

  function updateDefaultAgentListItem(patch) {
    setDraftConfig((prev) => {
      const list = prev.agents?.list || [];
      if (list.length === 0) return prev;
      const index = list.findIndex((item) => item.is_default);
      const targetIndex = index >= 0 ? index : 0;
      return {
        ...prev,
        agents: {
          ...prev.agents,
          list: list.map((item, i) =>
            i === targetIndex
              ? {
                  ...item,
                  ...patch,
                  tools: {
                    ...item.tools,
                    ...(patch.tools || {}),
                  },
                }
              : item,
          ),
        },
      };
    });
  }

  function setPrimaryModel(modelRef) {
    const current = defaultAgentConfig.model?.fallbacks || [];
    const nextFallbacks = current.filter((ref) => ref !== modelRef);
    updateDefaultAgentModel({
      primary: modelRef,
      fallbacks: nextFallbacks,
    });
  }

  function toggleFallback(modelRef, checked) {
    const primary = defaultAgentConfig.model?.primary || "";
    if (checked && modelRef === primary) return;
    const current = defaultAgentConfig.model?.fallbacks || [];
    if (checked) {
      if (current.includes(modelRef)) return;
      updateDefaultAgentModel({ fallbacks: [...current, modelRef] });
      return;
    }
    updateDefaultAgentModel({ fallbacks: current.filter((id) => id !== modelRef) });
  }

  return (
    <div className="settings-page settings-page-modern">
      <header className="settings-topbar">
        <div className="settings-tab-group">
          <button
            type="button"
            className={`settings-top-tab${activeTab === "models" ? " active" : ""}`}
            onClick={() => setActiveTab("models")}
          >
            Models
          </button>
          <button
            type="button"
            className={`settings-top-tab${activeTab === "agent" ? " active" : ""}`}
            onClick={() => setActiveTab("agent")}
          >
            Agent
          </button>
          <button
            type="button"
            className={`settings-top-tab${activeTab === "mcp" ? " active" : ""}`}
            onClick={() => setActiveTab("mcp")}
          >
            MCP
          </button>
          <button
            type="button"
            className={`settings-top-tab${activeTab === "context" ? " active" : ""}`}
            onClick={() => setActiveTab("context")}
          >
            Context
          </button>
          <button
            type="button"
            className={`settings-top-tab${activeTab === "chat" ? " active" : ""}`}
            onClick={() => setActiveTab("chat")}
          >
            Chat
          </button>
        </div>
      </header>

      {activeTab === "models" ? (
        <div className="settings-card">
          <aside className="settings-providers">
            <div className="settings-providers-list">
              {providerKeys.map((providerKey) => (
                <button
                  key={providerKey}
                  type="button"
                  className={`settings-provider-item${
                    selectedProviderKey === providerKey ? " active" : ""
                  }`}
                  onClick={() => {
                    setSelectedProviderKey(providerKey);
                  }}
                >
                  <span className="settings-provider-icon">
                    <SingleDotIcon size="xs" />
                  </span>
                  <span>{providerKey}</span>
                </button>
              ))}
            </div>
            <div className="settings-providers-footer">
              <button
                type="button"
                className="settings-provider-action-btn"
                title="新增 Provider"
                aria-label="新增 Provider"
                onClick={() => setProviderDialog({ mode: "add" })}
              >
                {ICON_PLUS}
              </button>
              <button
                type="button"
                className="settings-provider-action-btn"
                title="修改 Provider 名称"
                aria-label="修改 Provider 名称"
                disabled={!selectedProviderKey}
                onClick={() =>
                  setProviderDialog({ mode: "rename", initialName: selectedProviderKey })
                }
              >
                {ICON_EDIT}
              </button>
              <span className="settings-provider-action-divider" aria-hidden="true">
                ｜
              </span>
              <button
                type="button"
                className="settings-provider-action-btn"
                title="删除 Provider"
                aria-label="删除 Provider"
                disabled={!selectedProviderKey}
                onClick={() => setDeleteProviderConfirmOpen(true)}
              >
                {ICON_TRASH}
              </button>
            </div>
          </aside>

          <section className="settings-panel settings-panel-general" ref={modelsPanelRef}>
            {!selectedProvider ? (
              <p className="settings-empty">暂无可配置的模型提供商。</p>
            ) : (
              <>
                <h2 className="settings-general-title">{selectedProviderKey}</h2>
                <p className="settings-general-lead">
                  配置 API 连接并启用该 Provider 下的模型，供 Agent 页选择。
                </p>

                <SettingsGroup label="Connection">
                  <SettingsTextRow
                    title="Base URL"
                    description="Provider API 的根地址。"
                    value={selectedProvider.baseUrl || ""}
                    onChange={(value) => {
                      updateProvider({ baseUrl: value });
                      setProviderSyncError(selectedProviderKey, "");
                    }}
                    error={selectedProviderSyncError}
                    action={
                      <button
                        type="button"
                        className="settings-row-inline-btn"
                        title="刷新模型列表"
                        aria-label="刷新模型列表"
                        onClick={() => void handleSyncModels()}
                        disabled={syncLoading}
                      >
                        {ICON_REFRESH}
                      </button>
                    }
                  />
                  <SettingsTextRow
                    title="API Key"
                    description={withConfigFileLinks("写入本地 config.json，不会上传到其他地方。")}
                    type={showApiKey ? "text" : "password"}
                    value={selectedProvider.apiKey || ""}
                    onChange={(value) => updateProvider({ apiKey: value })}
                    action={
                      <button
                        type="button"
                        className="settings-row-inline-btn"
                        title={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                        aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                        onClick={() => setShowApiKey((prev) => !prev)}
                      >
                        {showApiKey ? ICON_EYE_OFF : ICON_EYE}
                      </button>
                    }
                  />
                  <SettingsTextRow
                    title="API Path"
                    description="相对 Base URL 的路径，通常为 chat/completions。"
                    value={selectedProvider.api || ""}
                    onChange={(value) => updateProvider({ api: value })}
                  />
                </SettingsGroup>

                <div className="settings-models-toolbar">
                  <h3 className="settings-group-label">
                    Models ({selectedProvider.models?.length || 0})
                  </h3>
                  <div className="settings-models-tools">
                    <select
                      className="settings-model-filter"
                      value={modelStateFilter}
                      onChange={(e) => setModelStateFilter(e.target.value)}
                      aria-label="筛选模型"
                    >
                      <option value="all">全部</option>
                      <option value="selected">已选</option>
                      <option value="unselected">未选</option>
                    </select>
                    <input
                      className="settings-model-search"
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      placeholder="Search models"
                      aria-label="搜索模型"
                    />
                  </div>
                </div>

                <SettingsGroup cardClassName="settings-group-card-scroll" className="settings-models-group">
                  {filteredModels.length ? (
                    filteredModels.map((model) => (
                      <SettingsModelRow
                        key={model.id}
                        title={model.id}
                        checked={Boolean(model.state)}
                        onToggle={(checked) => updateModelState(model.id, checked)}
                        onDelete={() => deleteModel(model.id)}
                      />
                    ))
                  ) : (
                    <div className="settings-row settings-row-empty">
                      {modelSearch.trim() || modelStateFilter !== "all"
                        ? "没有匹配的模型"
                        : "暂无模型，点击 Base URL 旁的刷新按钮同步"}
                    </div>
                  )}
                </SettingsGroup>

              </>
            )}
          </section>
        </div>
      ) : activeTab === "mcp" ? (
        <McpSettingsTab
          draftConfig={draftConfig}
          setDraftConfig={setDraftConfig}
          onProbeMcp={onProbeMcp}
        />
      ) : activeTab === "context" ? (
        <div className="settings-card settings-general-card">
          <div className="settings-general-scroll">
            <h2 className="settings-general-title">Context</h2>
            <p className="settings-general-lead">
              控制 MicroCompact、Session Memory 与 Full Compact。接近窗口上限时会自动压缩，也可手动使用
              /compact。
            </p>

            <SettingsGroup label="General">
              <SettingsToggleRow
                title="Auto-compact"
                description="接近上下文窗口上限时自动压缩较早对话。"
                checked={Boolean(contextDraft.auto_compact_enabled)}
                onChange={(checked) => updateContext({ auto_compact_enabled: checked })}
              />
              <SettingsToggleRow
                title="Session Memory"
                description="后台增量维护会话摘要，压缩时可跳过完整 LLM 摘要调用。"
                checked={Boolean(contextDraft.session_memory_enabled)}
                onChange={(checked) => updateContext({ session_memory_enabled: checked })}
              />
            </SettingsGroup>

            <SettingsGroup
              label="MicroCompact"
              footer="每轮对话前清空较早 tool 结果，保留最近几条完整输出。"
            >
              <SettingsNumberRow
                title="Keep recent tool results"
                description="活跃会话中保留的最近 tool 结果数量。"
                min={1}
                value={contextDraft.microcompact_keep_recent}
                onChange={(raw) =>
                  updateContextNumber("microcompact_keep_recent", raw, {
                    min: 1,
                    fallback: DEFAULT_CONTEXT_CONFIG.microcompact_keep_recent,
                  })
                }
              />
              <SettingsNumberRow
                title="Idle threshold"
                description="距上次 assistant 回复超过该分钟数后，启用更激进的清理。"
                min={1}
                value={contextDraft.microcompact_idle_minutes}
                onChange={(raw) =>
                  updateContextNumber("microcompact_idle_minutes", raw, {
                    min: 1,
                    fallback: DEFAULT_CONTEXT_CONFIG.microcompact_idle_minutes,
                  })
                }
              />
              <SettingsNumberRow
                title="Idle keep count"
                description="空闲模式下仍保留的 tool 结果数量。"
                min={1}
                value={contextDraft.microcompact_idle_keep_recent}
                onChange={(raw) =>
                  updateContextNumber("microcompact_idle_keep_recent", raw, {
                    min: 1,
                    fallback: DEFAULT_CONTEXT_CONFIG.microcompact_idle_keep_recent,
                  })
                }
              />
              <SettingsNumberRow
                title="Pre-compact keep count"
                description="执行 Full Compact 之前额外清理 tool 结果时保留的数量。"
                min={1}
                value={contextDraft.precompact_keep_recent}
                onChange={(raw) =>
                  updateContextNumber("precompact_keep_recent", raw, {
                    min: 1,
                    fallback: DEFAULT_CONTEXT_CONFIG.precompact_keep_recent,
                  })
                }
              />
            </SettingsGroup>

            <SettingsGroup
              label="Full Compact"
              footer="自动压缩触发点取“有效窗口 − 缓冲 tokens”和百分比上限中更早者。"
            >
              <SettingsNumberRow
                title="Auto trigger percent"
                description="自动压缩最晚触发的上下文占用百分比。"
                min={1}
                max={100}
                value={contextDraft.auto_compact_threshold_percent}
                onChange={(raw) =>
                  updateContextNumber("auto_compact_threshold_percent", raw, {
                    min: 1,
                    max: 100,
                    fallback: DEFAULT_CONTEXT_CONFIG.auto_compact_threshold_percent,
                  })
                }
              />
              <SettingsNumberRow
                title="Compact buffer"
                description="为压缩过程预留的 tokens，越大则越早触发。"
                min={1000}
                step={1000}
                value={contextDraft.compact_buffer_tokens}
                onChange={(raw) =>
                  updateContextNumber("compact_buffer_tokens", raw, {
                    min: 1000,
                    fallback: DEFAULT_CONTEXT_CONFIG.compact_buffer_tokens,
                  })
                }
              />
              <SettingsNumberRow
                title="Summary input limit"
                description="生成摘要时允许的最大输入 tokens。"
                min={10_000}
                step={1000}
                value={contextDraft.compact_max_input_tokens}
                onChange={(raw) =>
                  updateContextNumber("compact_max_input_tokens", raw, {
                    min: 10_000,
                    fallback: DEFAULT_CONTEXT_CONFIG.compact_max_input_tokens,
                  })
                }
              />
              <SettingsNumberRow
                title="Input too long retries"
                description="摘要输入过长时，从头部丢弃旧轮次的重试次数。"
                min={0}
                max={10}
                value={contextDraft.compact_ptl_max_retries}
                onChange={(raw) =>
                  updateContextNumber("compact_ptl_max_retries", raw, {
                    min: 0,
                    fallback: DEFAULT_CONTEXT_CONFIG.compact_ptl_max_retries,
                  })
                }
              />
            </SettingsGroup>

            <SettingsGroup label="Retention">
              <SettingsNumberRow
                title="Minimum keep tokens"
                description="Full Compact 后至少保留的最近消息 tokens。"
                min={1000}
                step={1000}
                value={contextDraft.keep_min_tokens}
                onChange={(raw) =>
                  updateContextNumber("keep_min_tokens", raw, {
                    min: 1000,
                    fallback: DEFAULT_CONTEXT_CONFIG.keep_min_tokens,
                  })
                }
              />
              <SettingsNumberRow
                title="Minimum text messages"
                description="Full Compact 后至少保留的含文本消息条数。"
                min={1}
                value={contextDraft.keep_min_text_messages}
                onChange={(raw) =>
                  updateContextNumber("keep_min_text_messages", raw, {
                    min: 1,
                    fallback: DEFAULT_CONTEXT_CONFIG.keep_min_text_messages,
                  })
                }
              />
              <SettingsNumberRow
                title="Maximum keep tokens"
                description="Full Compact 后保留区的 token 上限。"
                min={1000}
                step={1000}
                value={contextDraft.keep_max_tokens}
                onChange={(raw) =>
                  updateContextNumber("keep_max_tokens", raw, {
                    min: 1000,
                    fallback: DEFAULT_CONTEXT_CONFIG.keep_max_tokens,
                  })
                }
              />
            </SettingsGroup>

            <SettingsGroup label="Post-compact restore">
              <SettingsNumberRow
                title="Max restored files"
                description="压缩后重新注入的最近读取文件数量。"
                min={0}
                value={contextDraft.post_compact_max_files}
                onChange={(raw) =>
                  updateContextNumber("post_compact_max_files", raw, {
                    min: 0,
                    fallback: DEFAULT_CONTEXT_CONFIG.post_compact_max_files,
                  })
                }
              />
              <SettingsNumberRow
                title="File token budget"
                description="恢复文件摘要的总 token 预算。"
                min={1000}
                step={1000}
                value={contextDraft.post_compact_token_budget}
                onChange={(raw) =>
                  updateContextNumber("post_compact_token_budget", raw, {
                    min: 1000,
                    fallback: DEFAULT_CONTEXT_CONFIG.post_compact_token_budget,
                  })
                }
              />
              <SettingsNumberRow
                title="Max restored skills"
                description="压缩后重新注入的最近 load_skill 数量。"
                min={0}
                value={contextDraft.post_compact_max_skills}
                onChange={(raw) =>
                  updateContextNumber("post_compact_max_skills", raw, {
                    min: 0,
                    fallback: DEFAULT_CONTEXT_CONFIG.post_compact_max_skills,
                  })
                }
              />
              <SettingsNumberRow
                title="Skill token budget"
                description="恢复技能摘要的总 token 预算。"
                min={1000}
                step={1000}
                value={contextDraft.post_compact_skills_token_budget}
                onChange={(raw) =>
                  updateContextNumber("post_compact_skills_token_budget", raw, {
                    min: 1000,
                    fallback: DEFAULT_CONTEXT_CONFIG.post_compact_skills_token_budget,
                  })
                }
              />
            </SettingsGroup>
          </div>
        </div>
      ) : activeTab === "chat" ? (
        <div className="settings-card settings-general-card">
          <div className="settings-general-scroll">
            <h2 className="settings-general-title">Chat</h2>
            <p className="settings-general-lead">
              控制对话区展示方式，以及单次大模型请求的超时时间。
            </p>

            <SettingsGroup label="LLM">
              <SettingsNumberRow
                title="LLM 请求超时"
                description="单次大模型 API 请求的最长等待时间（秒）。慢模型或带 tools 的 agent 请求可适当调大。"
                value={uiDraft.llm_request_timeout_seconds}
                min={30}
                max={1800}
                step={30}
                onChange={(raw) =>
                  updateUiNumber("llm_request_timeout_seconds", raw, {
                    min: 30,
                    max: 1800,
                    fallback: DEFAULT_UI_CONFIG.llm_request_timeout_seconds,
                  })
                }
              />
            </SettingsGroup>

            <SettingsGroup label="Thinking">
              <SettingsToggleRow
                title="Verbose tool trace"
                description="开启后逐步展示每次 tool 调用与结果，不再合并为分组摘要。"
                checked={Boolean(uiDraft.verbose_thinking)}
                onChange={(checked) => updateUi({ verbose_thinking: checked })}
              />
            </SettingsGroup>

            <SettingsGroup label="Hooks">
              <SettingsToggleRow
                title="Enable project hooks"
                description={withConfigFileLinks(
                  "读取当前会话工作目录下的 hooks.json；若不存在则使用 config.json 同目录下的 hooks.json。",
                )}
                checked={uiDraft.hooks_enabled !== false}
                onChange={(checked) => updateUi({ hooks_enabled: checked })}
              />
            </SettingsGroup>
          </div>
        </div>
      ) : (
        <div className="settings-card settings-general-card">
          <div className="settings-general-scroll">
            <h2 className="settings-general-title">Agent</h2>
            <p className="settings-general-lead">
              配置默认模型、备用链路与工具能力。需在 Models 页启用模型后，方可在此选择。
            </p>

            <SettingsGroup label="Model">
              <SettingsSelectRow
                title="Primary model"
                description="主对话与压缩摘要使用的默认模型。"
                value={defaultAgentConfig.model?.primary || ""}
                onChange={setPrimaryModel}
              >
                {enabledModelRefs.map((modelRef) => (
                  <option key={modelRef} value={modelRef}>
                    {modelRef}
                  </option>
                ))}
              </SettingsSelectRow>
            </SettingsGroup>

            <SettingsGroup
              label="Fallback models"
              footer={
                enabledModelRefs.length
                  ? "主模型请求失败时，按勾选顺序依次尝试备用模型。"
                  : "请先在 Models 页启用至少一个模型。"
              }
            >
              {enabledModelRefs.length ? (
                enabledModelRefs.map((modelRef) => (
                  <SettingsToggleRow
                    key={modelRef}
                    title={modelRef}
                    description={
                      modelRef === defaultAgentConfig.model?.primary
                        ? "当前主模型，通常不必同时作为备用。"
                        : undefined
                    }
                    checked={
                      modelRef !== defaultAgentConfig.model?.primary &&
                      Boolean(defaultAgentConfig.model?.fallbacks?.includes(modelRef))
                    }
                    onChange={(checked) => toggleFallback(modelRef, checked)}
                  />
                ))
              ) : (
                <div className="settings-row settings-row-empty">暂无已启用模型</div>
              )}
            </SettingsGroup>

            <SettingsGroup label="Execution">
              <SettingsSelectRow
                title="Work mode"
                description="Plan 模式只读探索并写入会话目录下的 plan.md；Goal 模式按任务直接执行。"
                value={defaultAgentConfig.execution_mode || "goal"}
                onChange={updateDefaultExecutionMode}
              >
                <option value="plan">Plan（先出方案）</option>
                <option value="goal">Goal（直接执行）</option>
              </SettingsSelectRow>
              <SettingsNumberRow
                title="Max tool rounds"
                description="单轮用户消息内，模型连续调用工具的最大轮数。"
                min={1}
                value={defaultAgentListItem?.max_tool_rounds ?? 1}
                onChange={(raw) =>
                  updateDefaultAgentListItem({
                    max_tool_rounds: Number.parseInt(raw || "1", 10) || 1,
                  })
                }
              />
            </SettingsGroup>

            <SettingsGroup label="Tools">
              <SettingsToggleRow
                title="Enable tools"
                description="允许模型调用内置工具（bash、读写文件等）。"
                checked={Boolean(defaultAgentListItem?.tools?.enable_tools)}
                onChange={(checked) =>
                  updateDefaultAgentListItem({ tools: { enable_tools: checked } })
                }
              />
              <SettingsToggleRow
                title="Enable file tools"
                description="允许 read_file、write_file、list_dir 等文件操作。"
                checked={Boolean(defaultAgentListItem?.tools?.enable_file_tools)}
                onChange={(checked) =>
                  updateDefaultAgentListItem({ tools: { enable_file_tools: checked } })
                }
              />
              <SettingsToggleRow
                title="Enable skills"
                description="在 system prompt 中注入技能目录，并允许 load_skill。"
                checked={Boolean(defaultAgentListItem?.tools?.enable_skills)}
                onChange={(checked) =>
                  updateDefaultAgentListItem({ tools: { enable_skills: checked } })
                }
              />
              <SettingsToggleRow
                title="Enable MCP tools"
                description="允许 Agent 调用设置页中配置的 MCP Server 工具。"
                checked={defaultAgentListItem?.tools?.enable_mcp !== false}
                onChange={(checked) =>
                  updateDefaultAgentListItem({ tools: { enable_mcp: checked } })
                }
              />
              <SettingsToggleRow
                title="Enable computer use"
                description="允许 Agent 截屏并控制桌面鼠标/键盘（需 vision 模型；macOS 需辅助功能权限）。"
                checked={Boolean(defaultAgentListItem?.tools?.enable_computer_use)}
                onChange={(checked) =>
                  updateDefaultAgentListItem({ tools: { enable_computer_use: checked } })
                }
              />
              <SettingsToggleRow
                title="Allow sub-agents"
                description="允许主 Agent 通过 Task 工具启动子 Agent。"
                checked={Boolean(defaultAgentListItem?.tools?.allow_sub_agents)}
                onChange={(checked) =>
                  updateDefaultAgentListItem({ tools: { allow_sub_agents: checked } })
                }
              />
            </SettingsGroup>
          </div>
        </div>
      )}

      {activeTab === "models" ||
      activeTab === "context" ||
      activeTab === "chat" ||
      activeTab === "agent" ||
      activeTab === "mcp" ? (
        <footer className="settings-page-footer">
          <button type="button" className="settings-btn secondary" onClick={onBack}>
            取消
          </button>
          <button type="button" className="settings-btn primary" onClick={handleSave}>
            保存
          </button>
        </footer>
      ) : null}

      {providerDialog?.mode === "add" ? (
        <ProviderNameDialog
          title="新增 Provider"
          onClose={() => setProviderDialog(null)}
          onConfirm={addProvider}
        />
      ) : null}
      {providerDialog?.mode === "rename" ? (
        <ProviderNameDialog
          title="修改 Provider 名称"
          initialName={providerDialog.initialName || ""}
          onClose={() => setProviderDialog(null)}
          onConfirm={renameProvider}
        />
      ) : null}
      {deleteProviderConfirmOpen ? (
        <ConfirmDialog
          message={`确定删除 Provider「${selectedProviderKey}」？`}
          detail="该 Provider 的 API 连接、密钥及下属模型将被一并移除。保存设置后无法恢复，请确认后再操作。"
          confirmLabel="删除"
          cancelLabel="取消"
          destructive
          onClose={(confirmed) => {
            setDeleteProviderConfirmOpen(false);
            if (confirmed) deleteProvider();
          }}
        />
      ) : null}
    </div>
  );
}
