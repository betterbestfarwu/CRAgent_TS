import { useEffect, useMemo, useRef, useState } from "react";
import { SingleDotIcon } from "./DotGridAnimator.jsx";

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
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
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
    <div className="confirm-overlay" role="presentation" onClick={onClose}>
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

export function SettingsPage({ config, onBack, onSave, onSyncProviderModels }) {
  const [activeTab, setActiveTab] = useState("models");
  const [draftConfig, setDraftConfig] = useState(() => clone(config));
  const [modelSearch, setModelSearch] = useState("");
  const [modelStateFilter, setModelStateFilter] = useState("all");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [providerDialog, setProviderDialog] = useState(null);
  const modelListRef = useRef(null);
  const providerKeys = useMemo(
    () => Object.keys(draftConfig.models || {}),
    [draftConfig.models],
  );
  const [selectedProviderKey, setSelectedProviderKey] = useState(
    providerKeys[0] || "",
  );

  useEffect(() => {
    const next = clone(config);
    setDraftConfig(next);
    const keys = Object.keys(next.models || {});
    setSelectedProviderKey((prev) =>
      prev && keys.includes(prev) ? prev : keys[0] || "",
    );
  }, [config]);

  const selectedProvider = selectedProviderKey
    ? draftConfig.models?.[selectedProviderKey]
    : null;
  useEffect(() => {
    if (!selectedModelId) return;
    const exists = (selectedProvider?.models || []).some(
      (model) => model.id === selectedModelId,
    );
    if (!exists) setSelectedModelId("");
  }, [selectedProvider, selectedModelId]);

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
    modelListRef.current?.scrollTo({ top: 0 });
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
      setModelsError(`Provider「${providerKey}」已存在。`);
      return;
    }
    setModelsError("");
    setDraftConfig((prev) => ({
      ...prev,
      models: {
        ...prev.models,
        [providerKey]: createEmptyProvider(),
      },
    }));
    setSelectedProviderKey(providerKey);
    setSelectedModelId("");
    setProviderDialog(null);
  }

  function renameProvider(nextProviderKey) {
    if (!selectedProviderKey) return;
    if (nextProviderKey === selectedProviderKey) {
      setProviderDialog(null);
      return;
    }
    if (draftConfig.models?.[nextProviderKey]) {
      setModelsError(`Provider「${nextProviderKey}」已存在。`);
      return;
    }
    setModelsError("");
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
    const models = selectedProvider?.models || [];
    const deleteIndex = models.findIndex((model) => model.id === modelId);
    if (deleteIndex < 0) return;

    let nextSelectedId = selectedModelId;
    if (selectedModelId === modelId) {
      if (models.length > 1) {
        nextSelectedId =
          deleteIndex < models.length - 1
            ? models[deleteIndex + 1].id
            : models[deleteIndex - 1].id;
      } else {
        nextSelectedId = "";
      }
    }

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
    setSelectedModelId(nextSelectedId);
  }

  function handleSave() {
    void onSave(draftConfig);
  }

  async function handleSyncModels() {
    if (!selectedProviderKey || !onSyncProviderModels) {
      setModelsError("模型同步功能未就绪，请重启应用。");
      return;
    }
    setSyncLoading(true);
    setModelsError("");
    try {
      const result = await onSyncProviderModels(selectedProviderKey);
      setDraftConfig(clone(result.config));
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : String(err));
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

  function toggleFallback(modelRef, checked) {
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
                    setSelectedModelId("");
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
            </div>
          </aside>

          <section className="settings-panel">
            {!selectedProvider ? (
              <p className="settings-empty">暂无可配置的模型提供商。</p>
            ) : (
              <>
                <div className="settings-form">
                  <label className="settings-field settings-field-with-action">
                    <span>Base URL</span>
                    <div className="settings-input-wrap">
                      <input
                        value={selectedProvider.baseUrl || ""}
                        onChange={(e) => updateProvider({ baseUrl: e.target.value })}
                      />
                      <button
                        type="button"
                        className="settings-inline-btn settings-inline-btn-black"
                        title="刷新模型列表"
                        aria-label="刷新模型列表"
                        onClick={() => void handleSyncModels()}
                        disabled={syncLoading}
                      >
                        {ICON_REFRESH}
                      </button>
                    </div>
                  </label>

                  <label className="settings-field settings-field-with-action">
                    <span>API Key</span>
                    <div className="settings-input-wrap">
                      <input
                        type={showApiKey ? "text" : "password"}
                        value={selectedProvider.apiKey || ""}
                        onChange={(e) => updateProvider({ apiKey: e.target.value })}
                      />
                      <button
                        type="button"
                        className="settings-inline-btn"
                        title={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                        aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                        onClick={() => setShowApiKey((prev) => !prev)}
                      >
                        {showApiKey ? ICON_EYE_OFF : ICON_EYE}
                      </button>
                    </div>
                  </label>

                  <label className="settings-field">
                    <span>API Path</span>
                    <input
                      value={selectedProvider.api || ""}
                      onChange={(e) => updateProvider({ api: e.target.value })}
                    />
                  </label>
                </div>

                <div className="settings-models-header">
                  <h2>Models ({selectedProvider.models?.length || 0})</h2>
                  <div className="settings-models-tools">
                    <select
                      className="settings-model-filter"
                      value={modelStateFilter}
                      onChange={(e) => setModelStateFilter(e.target.value)}
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
                    />
                  </div>
                </div>

                <div className="settings-model-list-shell">
                  <div className="settings-model-list" ref={modelListRef}>
                  {filteredModels.map((model) => (
                    <div
                      key={model.id}
                      className={`settings-model-row${
                        selectedModelId === model.id ? " selected" : ""
                      }`}
                      onClick={() => setSelectedModelId(model.id)}
                    >
                      <span className="settings-model-name">{model.id}</span>
                      <div className="settings-model-actions">
                        <span className="settings-model-checkbox">
                          <input
                            type="checkbox"
                            checked={Boolean(model.state)}
                            onChange={(e) => updateModelState(model.id, e.target.checked)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`切换 ${model.id} 状态`}
                          />
                        </span>
                        <button
                          type="button"
                          className="settings-model-delete"
                          title="删除模型"
                          aria-label={`删除 ${model.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteModel(model.id);
                          }}
                        >
                          {ICON_TRASH}
                        </button>
                      </div>
                    </div>
                  ))}
                  </div>
                </div>

                {modelsError ? <p className="settings-error">{modelsError}</p> : null}
              </>
            )}
          </section>
        </div>
      ) : (
        <div className="settings-card settings-agent-card">
          <section className="settings-agent-panel">
            <label className="settings-field settings-agent-field">
              <span>Primary model</span>
              <select
                value={defaultAgentConfig.model?.primary || ""}
                onChange={(e) =>
                  updateDefaultAgentModel({ primary: e.target.value })
                }
              >
                {enabledModelRefs.map((modelRef) => (
                  <option key={modelRef} value={modelRef}>
                    {modelRef}
                  </option>
                ))}
              </select>
            </label>

            <div className="settings-field settings-agent-field settings-agent-fallbacks">
              <span>Fallbacks</span>
              <div className="settings-agent-fallback-list">
                {enabledModelRefs.map((modelRef) => (
                  <label key={modelRef} className="settings-agent-fallback-row">
                    <input
                      type="checkbox"
                      checked={Boolean(
                        defaultAgentConfig.model?.fallbacks?.includes(modelRef),
                      )}
                      onChange={(e) => toggleFallback(modelRef, e.target.checked)}
                    />
                    <span>{modelRef}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="settings-field settings-agent-field">
              <span>Max tool rounds</span>
              <input
                type="number"
                min={1}
                value={defaultAgentListItem?.max_tool_rounds ?? 1}
                onChange={(e) =>
                  updateDefaultAgentListItem({
                    max_tool_rounds: Number.parseInt(e.target.value || "1", 10) || 1,
                  })
                }
              />
            </label>

            <div className="settings-agent-toggles">
              <label className="settings-agent-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(defaultAgentListItem?.tools?.enable_tools)}
                  onChange={(e) =>
                    updateDefaultAgentListItem({
                      tools: { enable_tools: e.target.checked },
                    })
                  }
                />
                <span>Enable tools</span>
              </label>
              <label className="settings-agent-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(defaultAgentListItem?.tools?.enable_file_tools)}
                  onChange={(e) =>
                    updateDefaultAgentListItem({
                      tools: { enable_file_tools: e.target.checked },
                    })
                  }
                />
                <span>Enable file tools</span>
              </label>
              <label className="settings-agent-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(defaultAgentListItem?.tools?.enable_skills)}
                  onChange={(e) =>
                    updateDefaultAgentListItem({
                      tools: { enable_skills: e.target.checked },
                    })
                  }
                />
                <span>Enable skills</span>
              </label>
              <label className="settings-agent-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(defaultAgentListItem?.tools?.allow_sub_agents)}
                  onChange={(e) =>
                    updateDefaultAgentListItem({
                      tools: { allow_sub_agents: e.target.checked },
                    })
                  }
                />
                <span>Allow sub-agents</span>
              </label>
            </div>

            <button
              type="button"
              className="settings-agent-save settings-btn secondary"
              onClick={handleSave}
            >
              Save
            </button>
          </section>
        </div>
      )}

      {activeTab === "models" ? (
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
    </div>
  );
}
