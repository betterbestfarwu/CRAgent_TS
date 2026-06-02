import { useMemo, useState } from "react";

const STATUS_LABEL = {
    running: "运行中",
    success: "完成",
    blocked: "已拦截",
    error: "错误",
    cancelled: "已取消",
    skipped: "跳过",
};

function formatCommand(command) {
    const text = String(command || "").trim();
    if (!text) {
        return "(prompt hook)";
    }
    const parts = text.split(/[/\\]/);
    return parts[parts.length - 1] || text;
}

export function ComposerHookLog({ logs, onClear }) {
    const [expanded, setExpanded] = useState(false);
    const visible = useMemo(
        () => (Array.isArray(logs) ? logs.filter(Boolean) : []),
        [logs],
    );
    const latest = visible[visible.length - 1];

    if (!visible.length || !latest) {
        return null;
    }

    if (!expanded) {
        return (
            <div className="composer-hook-log composer-hook-log--compact">
                <button
                    type="button"
                    className="composer-hook-log-compact"
                    onClick={() => setExpanded(true)}
                    aria-expanded={false}
                    title="展开 hook 详情"
                >
                    <span className="composer-hook-log-event">{latest.event}</span>
                    <span className="composer-hook-log-command">{formatCommand(latest.command)}</span>
                    <span className={`composer-hook-log-pill status-${latest.status}`}>
                        {STATUS_LABEL[latest.status] || latest.status}
                    </span>
                    <span className="composer-hook-log-expand" aria-hidden="true">
                        ▾
                    </span>
                </button>
            </div>
        );
    }

    return (
        <div className="composer-hook-log composer-hook-log--expanded">
            <div className="composer-hook-log-header">
                <button
                    type="button"
                    className="composer-hook-log-toggle"
                    onClick={() => setExpanded(false)}
                    aria-expanded={true}
                >
                    <span className="composer-hook-log-expand" aria-hidden="true">
                        ▴
                    </span>
                    <span className="composer-hook-log-title">Hooks</span>
                    <span className="composer-hook-log-count">{visible.length}</span>
                </button>
                <button
                    type="button"
                    className="composer-hook-log-clear"
                    onClick={() => {
                        onClear?.();
                        setExpanded(false);
                    }}
                    title="清空 hook 日志"
                >
                    清空
                </button>
            </div>
            <ul className="composer-hook-log-list" aria-live="polite">
                {[...visible].reverse().map((entry) => (
                    <li key={entry.id || `${entry.timestamp}-${entry.event}`}>
                        <div className="composer-hook-log-row">
                            <span className="composer-hook-log-event">{entry.event}</span>
                            <span className={`composer-hook-log-status status-${entry.status}`}>
                                {STATUS_LABEL[entry.status] || entry.status}
                            </span>
                            {entry.durationMs != null ? (
                                <span className="composer-hook-log-ms">{entry.durationMs}ms</span>
                            ) : null}
                        </div>
                        <div className="composer-hook-log-command" title={entry.command}>
                            {formatCommand(entry.command)}
                            {entry.matchQuery ? (
                                <span className="composer-hook-log-match"> · {entry.matchQuery}</span>
                            ) : null}
                        </div>
                        {entry.detail ? (
                            <div className="composer-hook-log-detail">{entry.detail}</div>
                        ) : null}
                    </li>
                ))}
            </ul>
        </div>
    );
}
