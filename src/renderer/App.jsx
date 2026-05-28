import { useEffect, useMemo, useRef, useState } from "react";
import { ChatView } from "./ChatView.jsx";
import { Sidebar } from "./Sidebar.jsx";
import { SettingsPage } from "./SettingsPage.jsx";
import { titleFromFirstUserMessage } from "@shared/sessionTitle";
import { estimateTokens, formatTokens } from "./tokenEstimator";

const SUGGESTIONS = [
  "总结当前项目结构",
  "帮我写一段 README",
  "解释最近这段代码逻辑",
  "重构最近改动",
];

function sortSessions(sessions) {
  return [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function App() {
  const [sessions, setSessions] = useState([]);
  const [currentSession, setCurrentSession] = useState(null);
  const [config, setConfig] = useState(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState("chat");
  const [error, setError] = useState("");
  const [inputPanelHeight, setInputPanelHeight] = useState(160);
  const sessionIdRef = useRef(null);
  const chatLayoutRef = useRef(null);
  const busyBySessionRef = useRef(new Map());

  async function loadSnapshot() {
    if (!window.cragent) {
      setError("主进程桥接未就绪，请重启应用。");
      return;
    }
    try {
      const snapshot = await window.cragent.getSnapshot();
      setConfig(snapshot.config);
      const sorted = sortSessions(snapshot.sessions);
      setSessions(sorted);
      const sessionId = snapshot.currentSessionId || sorted[0]?.id;
      if (!sessionId) {
        setError("没有可用会话。");
        return;
      }
      const session = await window.cragent.getSession(sessionId);
      setCurrentSession(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    sessionIdRef.current = currentSession?.meta.id ?? null;
  }, [currentSession?.meta.id]);

  useEffect(() => {
    if (!window.cragent) return;
    void loadSnapshot();

    const offMessage = window.cragent.onMessageAppended(({ sessionId, message }) => {
      setCurrentSession((prev) => {
        if (!prev || prev.meta.id !== sessionId) return prev;
        return { ...prev, messages: [...prev.messages, message] };
      });
      setSessions((prev) =>
        sortSessions(
          prev.map((meta) =>
            meta.id === sessionId
              ? {
                  ...meta,
                  updatedAt: message.createdAt,
                  title:
                    (meta.title === "新对话" || meta.title === "New Chat") &&
                    message.role === "user"
                      ? titleFromFirstUserMessage(message.content) || meta.title
                      : meta.title,
                }
              : meta,
          ),
        ),
      );
    });

    const offSession = window.cragent.onSessionChanged((session) => {
      setCurrentSession(session);
      setPage("chat");
      setSessions((prev) => {
        const has = prev.some((s) => s.id === session.meta.id);
        return sortSessions(
          has
            ? prev.map((s) => (s.id === session.meta.id ? session.meta : s))
            : [session.meta, ...prev],
        );
      });
    });

    const offBusy = window.cragent.onBusyChanged(({ sessionId, busy: nextBusy }) => {
      busyBySessionRef.current.set(sessionId, nextBusy);
      if (sessionIdRef.current === sessionId) {
        setBusy(nextBusy);
      }
    });

    const offError = window.cragent.onError(({ message, sessionId }) => {
      setError(message);
      if (sessionId) {
        busyBySessionRef.current.set(sessionId, false);
        if (sessionIdRef.current === sessionId) {
          setBusy(false);
        }
      } else {
        setBusy(false);
      }
    });

    const offSettings = window.cragent.onOpenSettings(() => {
      setPage("settings");
    });

    return () => {
      offMessage();
      offSession();
      offBusy();
      offError();
      offSettings();
    };
  }, []);

  const currentModel = useMemo(() => {
    if (!config || !currentSession) return "";
    return `${currentSession.meta.providerKey}/${currentSession.meta.modelId}`;
  }, [config, currentSession]);

  const contextText = useMemo(() => {
    if (!currentSession || !config) return "";
    const used = estimateTokens(currentSession.messages);
    const model = config.models[currentSession.meta.providerKey]?.models.find(
      (m) => m.id === currentSession.meta.modelId,
    );
    const cap = model?.contextWindow ?? 0;
    if (!cap) return `Context ${formatTokens(used)} tok`;
    const pct = Math.round((used * 100) / cap);
    return `Context ${pct}% · ${formatTokens(used)} / ${formatTokens(cap)}`;
  }, [currentSession, config]);

  async function handleSend(text = input) {
    if (!currentSession || page !== "chat") return;
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    await window.cragent.sendChat({
      sessionId: currentSession.meta.id,
      userInput: trimmed,
    });
  }

  async function handleNewChat() {
    const next = await window.cragent.newSession();
    setCurrentSession(next);
    setSessions((prev) => sortSessions([next.meta, ...prev]));
    setPage("chat");
  }

  async function handleSwitchSession(sessionId) {
    const session = await window.cragent.getSession(sessionId);
    setCurrentSession(session);
    setBusy(busyBySessionRef.current.get(sessionId) ?? false);
    setPage("chat");
  }

  async function handleDeleteSession(meta) {
    if (!window.confirm(`删除「${meta.title || "新对话"}」？此操作无法撤销。`)) {
      return;
    }
    const session = await window.cragent.deleteSession(meta.id);
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== meta.id);
      if (next.some((s) => s.id === session.meta.id)) {
        return sortSessions(next);
      }
      return sortSessions([session.meta, ...next]);
    });
    if (currentSession?.meta.id === meta.id) {
      setCurrentSession(session);
      setPage("chat");
    }
  }

  async function handleModelChange(nextModel) {
    if (!currentSession) return;
    const [providerKey, modelId] = nextModel.split("/");
    await window.cragent.updateModel({
      sessionId: currentSession.meta.id,
      providerKey,
      modelId,
    });
  }

  async function saveConfig(next) {
    const updated = await window.cragent.updateConfig(next);
    setConfig(updated);
    setPage("chat");
  }

  function handleDeleteMessage(messageId) {
    setCurrentSession((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        messages: prev.messages.filter((m) => m.id !== messageId),
      };
    });
  }

  function startResizeDivider(event) {
    if (event.button !== 0) return;
    event.preventDefault();

    const splitter = event.currentTarget;
    const pointerId = event.pointerId;
    const startY = event.clientY;
    const startHeight = inputPanelHeight;
    const minInput = 120;
    const minChat = 120;

    splitter.setPointerCapture(pointerId);
    document.body.classList.add("chat-resizing");

    function applyHeight(clientY) {
      const layoutHeight =
        chatLayoutRef.current?.getBoundingClientRect().height ?? 600;
      const maxInput = Math.max(minInput, layoutHeight - minChat - 5);
      const delta = startY - clientY;
      const next = Math.min(maxInput, Math.max(minInput, startHeight + delta));
      setInputPanelHeight(next);
    }

    function endResize(endEvent) {
      if (endEvent.pointerId !== pointerId) return;
      splitter.releasePointerCapture(pointerId);
      document.body.classList.remove("chat-resizing");
      splitter.removeEventListener("pointermove", onPointerMove);
      splitter.removeEventListener("pointerup", endResize);
      splitter.removeEventListener("pointercancel", endResize);
    }

    function onPointerMove(moveEvent) {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      applyHeight(moveEvent.clientY);
    }

    splitter.addEventListener("pointermove", onPointerMove);
    splitter.addEventListener("pointerup", endResize);
    splitter.addEventListener("pointercancel", endResize);
  }

  const active = Boolean(currentSession && currentSession.messages.length > 0);
  const onSettingsPage = page === "settings";

  return (
    <div className="app">
      <Sidebar
        sessions={sessions}
        currentSessionId={currentSession?.meta.id}
        settingsActive={onSettingsPage}
        onSelect={(sessionId) => void handleSwitchSession(sessionId)}
        onDelete={(meta) => void handleDeleteSession(meta)}
        onNewChat={() => void handleNewChat()}
        onOpenSettings={() => setPage("settings")}
      />

      <main className={`main${onSettingsPage ? " main-settings" : ""}`}>
        {onSettingsPage && config ? (
          <SettingsPage
            config={config}
            onBack={() => setPage("chat")}
            onSave={saveConfig}
            onSyncProviderModels={async (providerKey) => {
              if (!window.cragent?.syncProviderModels) {
                throw new Error("主进程未支持模型同步，请重启应用。");
              }
              const result = await window.cragent.syncProviderModels({ providerKey });
              if (!result?.ok) {
                throw new Error(result?.error || "同步模型失败");
              }
              setConfig(result.config);
              return result;
            }}
          />
        ) : (
          <div
            className="chat-layout"
            ref={chatLayoutRef}
            style={{ "--input-panel-height": `${inputPanelHeight}px` }}
          >
            <div className="chat-history">
              {!active ? (
                <div className="empty-state">
                  <h1>我们该构建什么？</h1>
                  <div className="suggestions">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} type="button" onClick={() => void handleSend(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <ChatView
                  messages={currentSession.messages}
                  busy={busy}
                  onDelete={handleDeleteMessage}
                />
              )}
            </div>

            <div
              className="chat-splitter"
              role="separator"
              aria-orientation="horizontal"
              aria-valuenow={inputPanelHeight}
              aria-label="调整输入区高度"
              onPointerDown={startResizeDivider}
            />

            <div className="input-card">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="给 CRAgent 发送消息..."
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.altKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                disabled={busy}
              />
              <div className="input-bar">
                <select
                  value={currentModel}
                  onChange={(e) => void handleModelChange(e.target.value)}
                >
                  {Object.entries(config?.models || {}).flatMap(([providerKey, provider]) =>
                    provider.models
                      .filter(
                        (model) =>
                          model.state ||
                          currentModel === `${providerKey}/${model.id}`,
                      )
                      .map((model) => (
                        <option
                          key={`${providerKey}/${model.id}`}
                          value={`${providerKey}/${model.id}`}
                        >
                          {providerKey}/{model.id}
                        </option>
                      )),
                  )}
                </select>
                <span>{contextText}</span>
                <button type="button" onClick={() => void handleSend()} disabled={busy}>
                  {busy ? "..." : "Send"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {error ? (
        <div className="error-toast" onClick={() => setError("")}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
