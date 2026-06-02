import { useEffect, useMemo, useState } from "react";
import {
    createEmptyMcpServer,
    formatMcpArgsForEditor,
    formatMcpEnvForEditor,
    parseMcpArgsFromEditor,
    parseMcpEnvFromEditor,
    suggestNextMcpServerId,
    validateMcpServerDraft,
} from "@shared/mcpConfig.js";
import { ConfirmDialog } from "./ConfirmDialog.jsx";
import { withConfigFileLinks } from "./ConfigFileLink.jsx";
import { SingleDotIcon } from "./DotGridAnimator.jsx";

const ICON_PLUS = (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
        <line x1="12" y1="3" x2="12" y2="21" />
        <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
);

const ICON_TRASH = (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
);

const ICON_REFRESH = (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
    </svg>
);

function SettingsGroup({ label, children, footer, cardClassName = "", className = "" }) {
    return (
        <section className={`settings-group${className ? ` ${className}` : ""}`}>
            {label ? <h3 className="settings-group-label">{label}</h3> : null}
            <div className={`settings-group-card${cardClassName ? ` ${cardClassName}` : ""}`}>{children}</div>
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

function SettingsTextRow({ title, description, value, onChange, placeholder = "" }) {
    return (
        <div className="settings-row settings-row-field settings-mcp-field">
            <div className="settings-row-copy">
                <div className="settings-row-title">{title}</div>
                {description ? <div className="settings-row-description">{description}</div> : null}
            </div>
            <div className="settings-row-input-wrap">
                <input
                    className="settings-row-text"
                    type="text"
                    value={value}
                    placeholder={placeholder}
                    onChange={(e) => onChange(e.target.value)}
                    aria-label={title}
                />
            </div>
        </div>
    );
}

function SettingsTextAreaRow({ title, description, value, onChange, placeholder = "", rows = 4 }) {
    return (
        <div className="settings-row settings-row-field settings-mcp-field">
            <div className="settings-row-copy">
                <div className="settings-row-title">{title}</div>
                {description ? <div className="settings-row-description">{description}</div> : null}
            </div>
            <div className="settings-row-input-wrap settings-row-input-wrap-wide">
                <textarea
                    className="settings-row-textarea"
                    value={value}
                    rows={rows}
                    placeholder={placeholder}
                    onChange={(e) => onChange(e.target.value)}
                    aria-label={title}
                />
            </div>
        </div>
    );
}

export function McpSettingsTab({ draftConfig, setDraftConfig, onProbeMcp }) {
    const servers = draftConfig.mcp?.servers || [];
    const [selectedServerId, setSelectedServerId] = useState(servers[0]?.id || "");
    const [probeLoading, setProbeLoading] = useState(false);
    const [probeResult, setProbeResult] = useState(null);
    const [probeError, setProbeError] = useState("");
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

    useEffect(() => {
        if (!servers.length) {
            setSelectedServerId("");
            return;
        }
        if (!servers.some((server) => server.id === selectedServerId)) {
            setSelectedServerId(servers[0]?.id || "");
        }
    }, [servers, selectedServerId]);

    const selectedIndex = servers.findIndex((server) => server.id === selectedServerId);
    const selectedServer = selectedIndex >= 0 ? servers[selectedIndex] : null;
    const selectedValidation = selectedServer ? validateMcpServerDraft(selectedServer) : null;

    const argsText = useMemo(
        () => (selectedServer ? formatMcpArgsForEditor(selectedServer.args) : ""),
        [selectedServer],
    );
    const envText = useMemo(
        () => (selectedServer ? formatMcpEnvForEditor(selectedServer.env) : ""),
        [selectedServer],
    );

    function updateMcp(patch) {
        setDraftConfig((prev) => ({
            ...prev,
            mcp: {
                enabled: prev.mcp?.enabled !== false,
                servers: prev.mcp?.servers || [],
                ...patch,
            },
        }));
    }

    function updateSelectedServer(patch) {
        if (selectedIndex < 0) return;
        setDraftConfig((prev) => {
            const list = [...(prev.mcp?.servers || [])];
            const current = list[selectedIndex];
            const nextId = patch.id !== undefined ? String(patch.id).trim() : current.id;
            list[selectedIndex] = { ...current, ...patch, id: nextId };
            return {
                ...prev,
                mcp: {
                    enabled: prev.mcp?.enabled !== false,
                    servers: list,
                },
            };
        });
        if (patch.id !== undefined) {
            setSelectedServerId(String(patch.id).trim());
        }
    }

    function addServer() {
        const id = suggestNextMcpServerId(servers);
        const next = createEmptyMcpServer(id);
        setDraftConfig((prev) => ({
            ...prev,
            mcp: {
                enabled: prev.mcp?.enabled !== false,
                servers: [...(prev.mcp?.servers || []), next],
            },
        }));
        setSelectedServerId(id);
        setProbeResult(null);
        setProbeError("");
    }

    function deleteSelectedServer() {
        if (selectedIndex < 0) return;
        setDraftConfig((prev) => {
            const list = (prev.mcp?.servers || []).filter((_, index) => index !== selectedIndex);
            return {
                ...prev,
                mcp: {
                    enabled: prev.mcp?.enabled !== false,
                    servers: list,
                },
            };
        });
        setProbeResult(null);
        setProbeError("");
    }

    async function handleProbe() {
        if (!onProbeMcp) {
            setProbeError("MCP 测试仅在桌面版可用。");
            return;
        }
        setProbeLoading(true);
        setProbeError("");
        setProbeResult(null);
        try {
            const result = await onProbeMcp(draftConfig.mcp);
            if (!result?.ok) {
                setProbeError(result?.error || "连接测试失败");
                return;
            }
            setProbeResult(result);
        } catch (error) {
            setProbeError(error instanceof Error ? error.message : String(error));
        } finally {
            setProbeLoading(false);
        }
    }

    return (
        <div className="settings-card">
            <aside className="settings-providers">
                <div className="settings-providers-list">
                    {servers.length ? (
                        servers.map((server) => (
                            <button
                                key={server.id || `server-${server.command}`}
                                type="button"
                                className={`settings-provider-item${
                                    selectedServerId === server.id ? " active" : ""
                                }`}
                                onClick={() => setSelectedServerId(server.id)}
                            >
                                <span className="settings-provider-icon">
                                    <SingleDotIcon size="xs" />
                                </span>
                                <span className="settings-mcp-server-label">
                                    {server.id || "(未命名)"}
                                    {server.disabled ? (
                                        <span className="settings-mcp-badge">已禁用</span>
                                    ) : null}
                                </span>
                            </button>
                        ))
                    ) : (
                        <p className="settings-mcp-empty-list">暂无 MCP Server</p>
                    )}
                </div>
                <div className="settings-providers-footer">
                    <button
                        type="button"
                        className="settings-provider-action-btn"
                        title="新增 MCP Server"
                        aria-label="新增 MCP Server"
                        onClick={addServer}
                    >
                        {ICON_PLUS}
                    </button>
                    <span className="settings-provider-action-divider" aria-hidden="true">
                        ｜
                    </span>
                    <button
                        type="button"
                        className="settings-provider-action-btn"
                        title="删除 MCP Server"
                        aria-label="删除 MCP Server"
                        disabled={!selectedServer}
                        onClick={() => setDeleteConfirmOpen(true)}
                    >
                        {ICON_TRASH}
                    </button>
                </div>
            </aside>

            <section className="settings-panel settings-panel-general settings-panel-mcp">
                <h2 className="settings-general-title">MCP</h2>
                <p className="settings-general-lead">
                    通过 stdio 启动外部 MCP Server，并将其工具以 <code>mcp__server__tool</code>{" "}
                    形式提供给 Agent。保存设置后会自动重新加载工具列表。
                </p>

                <SettingsGroup label="General">
                    <SettingsToggleRow
                        title="Enable MCP"
                        description="关闭后不会连接下方任何 MCP Server。"
                        checked={draftConfig.mcp?.enabled !== false}
                        onChange={(checked) => updateMcp({ enabled: checked })}
                    />
                </SettingsGroup>

                {!selectedServer ? (
                    <p className="settings-empty">
                        点击左侧 + 添加 MCP Server，或从 {withConfigFileLinks("config.json")} 手动编辑。
                    </p>
                ) : (
                    <>
                        <SettingsGroup label="Server">
                            <SettingsTextRow
                                title="Server ID"
                                description="字母开头，仅含字母、数字、_、-。用于工具名前缀。"
                                value={selectedServer.id || ""}
                                placeholder="my-mcp-server"
                                onChange={(value) => updateSelectedServer({ id: value })}
                            />
                            <SettingsTextRow
                                title="Command"
                                description="启动 MCP Server 的可执行文件，例如 node、npx、uv。"
                                value={selectedServer.command || ""}
                                placeholder="node"
                                onChange={(value) => updateSelectedServer({ command: value })}
                            />
                            <SettingsTextAreaRow
                                title="Arguments"
                                description="每行一个参数，按顺序传给 command。"
                                value={argsText}
                                placeholder={"/path/to/server.mjs\n--flag value"}
                                rows={4}
                                onChange={(value) =>
                                    updateSelectedServer({ args: parseMcpArgsFromEditor(value) })
                                }
                            />
                            <SettingsTextRow
                                title="Working directory"
                                description="可选。子进程的工作目录。"
                                value={selectedServer.cwd || ""}
                                placeholder="~/.CRAgent"
                                onChange={(value) => updateSelectedServer({ cwd: value })}
                            />
                            <SettingsTextAreaRow
                                title="Environment"
                                description="可选。每行 KEY=VALUE，例如 API_KEY=secret。"
                                value={envText}
                                placeholder="PATH=/usr/local/bin:/usr/bin"
                                rows={3}
                                onChange={(value) =>
                                    updateSelectedServer({ env: parseMcpEnvFromEditor(value) || {} })
                                }
                            />
                            <SettingsToggleRow
                                title="Disabled"
                                description="保留配置但不连接此 Server。"
                                checked={Boolean(selectedServer.disabled)}
                                onChange={(checked) => updateSelectedServer({ disabled: checked })}
                            />
                        </SettingsGroup>

                        {selectedValidation ? (
                            <p className="settings-error">{selectedValidation}</p>
                        ) : null}

                        <div className="settings-mcp-probe-bar">
                            <button
                                type="button"
                                className="settings-btn secondary settings-mcp-probe-btn"
                                disabled={probeLoading || Boolean(selectedValidation)}
                                onClick={() => void handleProbe()}
                            >
                                <span className="settings-mcp-probe-icon">{ICON_REFRESH}</span>
                                {probeLoading ? "测试中…" : "测试连接"}
                            </button>
                            <p className="settings-mcp-probe-hint">
                                使用当前表单内容探测（无需先保存）。
                            </p>
                        </div>

                        {probeError ? <p className="settings-error">{probeError}</p> : null}

                        {probeResult ? (
                            <SettingsGroup
                                label="Probe result"
                                footer={withConfigFileLinks(
                                    "保存设置后，主进程会使用 config.json 中的配置常驻连接。",
                                )}
                            >
                                <div className="settings-row settings-row-empty">
                                    发现 {probeResult.toolCount} 个工具
                                </div>
                                {(probeResult.tools || []).map((tool) => (
                                    <div key={`${tool.serverId}-${tool.name}`} className="settings-row">
                                        <div className="settings-row-copy">
                                            <div className="settings-row-title settings-row-title-mono">
                                                {tool.registryName}
                                            </div>
                                            <div className="settings-row-description">
                                                {tool.serverId} / {tool.name}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {Object.entries(probeResult.errors || {}).map(([serverId, message]) => (
                                    <div key={serverId} className="settings-row">
                                        <div className="settings-row-copy">
                                            <div className="settings-row-title">{serverId}</div>
                                            <div className="settings-row-description settings-error-inline">
                                                {message}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </SettingsGroup>
                        ) : null}
                    </>
                )}
            </section>

            {deleteConfirmOpen ? (
                <ConfirmDialog
                    message={`确定删除 MCP Server「${selectedServerId}」？`}
                    detail={withConfigFileLinks("删除后需保存设置才会写入 config.json。")}
                    confirmLabel="删除"
                    cancelLabel="取消"
                    destructive
                    onClose={(confirmed) => {
                        setDeleteConfirmOpen(false);
                        if (confirmed) deleteSelectedServer();
                    }}
                />
            ) : null}
        </div>
    );
}
