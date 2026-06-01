import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChatView } from "./ChatView.jsx";
import { ComposerAuthMenu } from "./ComposerAuthMenu.jsx";
import { ComposerContextRing } from "./ComposerContextRing.jsx";
import { ComposerContextPopup } from "./ComposerContextPopup.jsx";
import { ComposerQueuePanel } from "./ComposerQueuePanel.jsx";
import {
  buildSlashMenuNavItems,
  ComposerSlashMenu,
  filterSlashCommands,
  filterSlashSkills,
} from "./ComposerSlashMenu.jsx";
import { Sidebar } from "./Sidebar.jsx";
import { SettingsPage } from "./SettingsPage.jsx";
import { ConfirmDialog } from "./ConfirmDialog.jsx";
import { ImageViewer } from "./ImageViewer.jsx";
import { TitleBar } from "./TitleBar.jsx";
import { displayTitle } from "./sidebarUtils.js";
import { isDefaultSessionTitle, titleFromFirstUserMessage } from "@shared/sessionTitle";
import { collectMessageIdsForDeletion } from "@shared/chatMessages";
import { filesToImageAttachments, toStoredImages } from "@shared/chatImages";
import { estimateSessionContextBreakdown } from "@shared/tokenEstimator";

const SUGGESTIONS = [
  "总结当前项目结构",
  "帮我写一段 README",
  "解释最近这段代码逻辑",
  "重构最近改动",
];

const COMPOSER_LINE_HEIGHT = 24;
const COMPOSER_MIN_HEIGHT = COMPOSER_LINE_HEIGHT;
/** ~3 行可视高度，达到 2 倍后出现滚动条 */
const COMPOSER_BASE_HEIGHT = COMPOSER_LINE_HEIGHT * 3;
const COMPOSER_MAX_HEIGHT = COMPOSER_BASE_HEIGHT * 2;

function sortSessions(sessions) {
  return [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function sessionMessagesEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i].id !== right[i].id) return false;
  }
  return true;
}

export function App() {
  const [sessions, setSessions] = useState([]);
  const [currentSession, setCurrentSession] = useState(null);
  const [config, setConfig] = useState(null);
  const [skills, setSkills] = useState([]);
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState([]);
  const [composerDragOver, setComposerDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyBySession, setBusyBySession] = useState({});
  const [page, setPage] = useState("chat");
  const [sessionError, setSessionError] = useState(null);
  const [compactLayout, setCompactLayout] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [confirmRequest, setConfirmRequest] = useState(null);
  const [viewerImage, setViewerImage] = useState(null);
  const [messageQueue, setMessageQueue] = useState([]);
  const [queuePanelOpen, setQueuePanelOpen] = useState(false);
  const [contextPopupOpen, setContextPopupOpen] = useState(false);
  const contextRingRef = useRef(null);
  const sessionIdRef = useRef(null);
  const sessionErrorTimerRef = useRef(null);
  const textareaRef = useRef(null);
  const busyBySessionRef = useRef(new Map());
  const newChatInFlightRef = useRef(false);

  const askConfirm = useCallback((options) => {
    return new Promise((resolve) => {
      setConfirmRequest({ ...options, resolve });
    });
  }, []);

  const clearSessionError = useCallback(() => {
    if (sessionErrorTimerRef.current) {
      clearTimeout(sessionErrorTimerRef.current);
      sessionErrorTimerRef.current = null;
    }
    setSessionError(null);
  }, []);

  const showSessionError = useCallback(
    (message, sessionId) => {
      if (!message) return;
      clearSessionError();
      setSessionError({ message, sessionId });
      sessionErrorTimerRef.current = setTimeout(() => {
        setSessionError(null);
        sessionErrorTimerRef.current = null;
      }, 3000);
    },
    [clearSessionError],
  );

  const refreshSkills = useCallback(async () => {
    if (!window.cragent?.listSkills) return;
    try {
      const next = await window.cragent.listSkills();
      setSkills(Array.isArray(next) ? next : []);
    } catch {
      // Ignore skill loading failures in composer.
    }
  }, []);

  async function loadSnapshot() {
    if (!window.cragent) {
      showSessionError("主进程桥接未就绪，请重启应用。");
      return;
    }
    try {
      const snapshot = await window.cragent.getSnapshot();
      setConfig(snapshot.config);
      const sorted = sortSessions(snapshot.sessions);
      setSessions(sorted);
      const sessionId = snapshot.currentSessionId || sorted[0]?.id;
      if (!sessionId) {
        showSessionError("没有可用会话。");
        return;
      }
      const session = await window.cragent.getSession(sessionId);
      setCurrentSession(session);
    } catch (err) {
      showSessionError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    sessionIdRef.current = currentSession?.meta.id ?? null;
  }, [currentSession?.meta.id]);

  useEffect(() => () => clearSessionError(), [clearSessionError]);

  function resizeComposer() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const scrollHeight = el.scrollHeight;
    const next = Math.min(COMPOSER_MAX_HEIGHT, Math.max(COMPOSER_MIN_HEIGHT, scrollHeight));
    el.style.height = `${next}px`;
    el.style.overflowY = scrollHeight > COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
  }

  useLayoutEffect(() => {
    resizeComposer();
  }, [input, page, pendingImages.length]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 834px)");
    const updateLayout = () => {
      const compact = media.matches;
      setCompactLayout(compact);
      setSidebarOpen(!compact);
    };
    updateLayout();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", updateLayout);
      return () => media.removeEventListener("change", updateLayout);
    }
    media.addListener(updateLayout);
    return () => media.removeListener(updateLayout);
  }, []);

  useEffect(() => {
    if (!window.cragent) return;
    void loadSnapshot();
    void refreshSkills();

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
                    isDefaultSessionTitle(meta.title) &&
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
      clearSessionError();
      setCurrentSession((prev) => {
        if (
          prev &&
          prev.meta.id === session.meta.id &&
          sessionMessagesEqual(prev.messages, session.messages)
        ) {
          return { ...session, messages: prev.messages };
        }
        return session;
      });
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
      setBusyBySession((prev) => ({ ...prev, [sessionId]: nextBusy }));
      if (sessionIdRef.current === sessionId) {
        setBusy(nextBusy);
      }
    });

    const offTodos = window.cragent.onTodosChanged?.(({ sessionId, todoRuns }) => {
      setCurrentSession((prev) => {
        if (!prev || prev.meta.id !== sessionId) return prev;
        return {
          ...prev,
          meta: {
            ...prev.meta,
            todoRuns: todoRuns || prev.meta.todoRuns,
          },
        };
      });
    });

    const offQueue = window.cragent.onQueueChanged?.(({ sessionId, queue }) => {
      if (sessionIdRef.current !== sessionId) return;
      setMessageQueue(Array.isArray(queue) ? queue : []);
      if (!queue?.length) {
        setQueuePanelOpen(false);
      }
    });

    const offConfirm = window.cragent.onConfirmRequest?.((payload) => {
      setConfirmRequest({
        title: payload.title,
        message: payload.message,
        detail: payload.detail,
        confirmLabel: payload.confirmLabel || "允许",
        cancelLabel: payload.cancelLabel || "拒绝",
        destructive: payload.destructive,
        resolve: (confirmed) => {
          window.cragent.respondConfirm?.({ id: payload.id, confirmed });
        },
      });
    });

    const offError = window.cragent.onError(({ message, sessionId }) => {
      if (!sessionId || sessionIdRef.current === sessionId) {
        showSessionError(message, sessionId);
      }
      if (sessionId) {
        busyBySessionRef.current.set(sessionId, false);
        setBusyBySession((prev) => ({ ...prev, [sessionId]: false }));
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
      offTodos?.();
      offQueue?.();
      offConfirm?.();
      offError();
      offSettings();
    };
  }, []);

  useEffect(() => {
    if (!busy) {
      void refreshSkills();
    }
  }, [busy, refreshSkills]);

  const currentModel = useMemo(() => {
    if (!config || !currentSession) return "";
    return `${currentSession.meta.providerKey}/${currentSession.meta.modelId}`;
  }, [config, currentSession]);

  const [modelDisplay, setModelDisplay] = useState("");

  useEffect(() => {
    setModelDisplay(currentModel);
  }, [currentModel]);

  const contextUsage = useMemo(() => {
    if (!currentSession || !config) return null;
    const model = config.models[currentSession.meta.providerKey]?.models.find(
      (m) => m.id === currentSession.meta.modelId,
    );
    const compactBuffer = config.context?.compact_buffer_tokens;
    const defaultAgent =
      config.agents?.list?.find((agent) => agent.is_default) || config.agents?.list?.[0];
    const agentTools = defaultAgent?.tools || {};
    const skillsCatalogText = skills
      .map((skill) => `- ${skill.name}: ${skill.description || ""}`)
      .join("\n");
    return estimateSessionContextBreakdown(currentSession, model, {
      compactBufferTokens: compactBuffer,
      agentTools,
      skillsCatalogText,
    });
  }, [currentSession, config, skills]);

  const slashQuery = useMemo(() => {
    const match = input.match(/^\/([^\s]*)$/);
    return match ? match[1].toLowerCase() : null;
  }, [input]);

  const canSend = Boolean(input.trim()) || pendingImages.length > 0;

  const slashFilterQuery = slashQuery === null ? "" : slashQuery.trim();

  const filteredSkills = useMemo(() => {
    if (slashQuery === null) return [];
    return filterSlashSkills(skills, slashFilterQuery);
  }, [slashQuery, slashFilterQuery, skills]);

  const filteredCommands = useMemo(() => {
    if (slashQuery === null) return [];
    return filterSlashCommands(slashFilterQuery);
  }, [slashQuery, slashFilterQuery]);

  const [slashMenuIndex, setSlashMenuIndex] = useState(0);
  const [skillsExpanded, setSkillsExpanded] = useState(false);

  const slashNavItems = useMemo(() => {
    if (slashQuery === null) return [];
    return buildSlashMenuNavItems(filteredSkills, filteredCommands, skillsExpanded);
  }, [slashQuery, filteredSkills, filteredCommands, skillsExpanded]);

  useEffect(() => {
    setSlashMenuIndex(0);
    setSkillsExpanded(false);
  }, [slashQuery]);

  useEffect(() => {
    if (!slashNavItems.length) {
      setSlashMenuIndex(0);
      return;
    }
    if (slashMenuIndex >= slashNavItems.length) {
      setSlashMenuIndex(0);
    }
  }, [slashNavItems, slashMenuIndex]);

  const showSlashMenu = page === "chat" && slashQuery !== null;

  function applySlashPick(name) {
    const next = `/${name} `;
    setInput(next);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      resizeComposer();
    });
  }

  function activateSlashMenuItem(item) {
    if (!item) return;
    if (item.kind === "expand") {
      setSkillsExpanded(true);
      return;
    }
    applySlashPick(item.name);
  }

  async function addImagesFromFiles(fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;

    const { accepted, errors } = await filesToImageAttachments(files, pendingImages.length);
    if (accepted.length) {
      setPendingImages((prev) => [...prev, ...accepted]);
    }
    if (errors.length) {
      showSessionError(errors[0], currentSession?.meta.id);
    }
  }

  function removePendingImage(imageId) {
    setPendingImages((prev) => prev.filter((image) => image.id !== imageId));
  }

  async function handleSend(text = input) {
    if (!currentSession || page !== "chat") return;
    const trimmed = text.trim();
    if (!trimmed && !pendingImages.length) return;

    const sessionId = currentSession.meta.id;
    const images = toStoredImages(pendingImages);

    if (busy) {
      setInput("");
      setPendingImages([]);
      setComposerDragOver(false);
      try {
        await window.cragent.sendChat({
          sessionId,
          userInput: trimmed,
          images,
        });
        setQueuePanelOpen(true);
      } catch (err) {
        showSessionError(err instanceof Error ? err.message : String(err), sessionId);
      }
      return;
    }

    setInput("");
    setPendingImages([]);
    setComposerDragOver(false);

    try {
      await window.cragent.sendChat({
        sessionId,
        userInput: trimmed,
        images,
      });
    } catch (err) {
      showSessionError(err instanceof Error ? err.message : String(err), sessionId);
    }
  }

  async function handleCancelRun() {
    if (!currentSession || !busy) return;
    await window.cragent.cancelRun?.(currentSession.meta.id);
  }

  async function handleAuthModeChange(nextMode) {
    if (!currentSession) return;
    const session = await window.cragent.updateAuthMode?.({
      sessionId: currentSession.meta.id,
      authMode: nextMode,
    });
    if (session) {
      setCurrentSession(session);
    }
  }

  function removeQueuedMessage(messageId) {
    if (!currentSession) return;
    setMessageQueue((prev) => prev.filter((item) => item.id !== messageId));
    void window.cragent.removeQueuedMessage?.({
      sessionId: currentSession.meta.id,
      messageId,
    });
  }

  async function handleNewChat() {
    if (newChatInFlightRef.current) return;
    newChatInFlightRef.current = true;
    try {
      clearSessionError();
      const localPlaceholder = sessions
        .filter((meta) => isDefaultSessionTitle(meta.title))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      if (localPlaceholder) {
        await handleSwitchSession(localPlaceholder.id);
        return;
      }
      const next = await window.cragent.newSession();
      setCurrentSession(next);
      setSessions((prev) => {
        const has = prev.some((s) => s.id === next.meta.id);
        if (has) return sortSessions(prev);
        return sortSessions([next.meta, ...prev]);
      });
      setPage("chat");
      if (compactLayout) setSidebarOpen(false);
    } finally {
      newChatInFlightRef.current = false;
    }
  }

  async function handleSwitchSession(sessionId) {
    clearSessionError();
    const session = await window.cragent.getSession(sessionId);
    setCurrentSession(session);
    setBusy(busyBySessionRef.current.get(sessionId) ?? false);
    setPage("chat");
    if (compactLayout) setSidebarOpen(false);
  }

  async function handleDeleteSession(meta) {
    const title = meta.title || "新会话";
    const confirmed = await askConfirm({
      message: `删除「${title}」？`,
      detail: "此操作无法撤销。",
      confirmLabel: "删除",
      cancelLabel: "取消",
      destructive: true,
    });
    if (!confirmed) {
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
    if (compactLayout) setSidebarOpen(false);
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
    if (compactLayout) setSidebarOpen(false);
  }

  async function handleDeleteMessage(messageId) {
    if (!currentSession || !window.cragent?.deleteMessages) return;
    const messageIds = collectMessageIdsForDeletion(currentSession.messages, messageId);
    if (!messageIds.length) return;
    try {
      const session = await window.cragent.deleteMessages({
        sessionId: currentSession.meta.id,
        messageIds,
      });
      setCurrentSession(session);
    } catch (err) {
      showSessionError(err instanceof Error ? err.message : String(err), currentSession.meta.id);
    }
  }

  const active = Boolean(currentSession && currentSession.messages.length > 0);
  const onSettingsPage = page === "settings";

  const titleBarLabel = useMemo(() => {
    if (onSettingsPage) return "设置";
    if (currentSession?.meta) return displayTitle(currentSession.meta);
    return "CRAgent";
  }, [onSettingsPage, currentSession?.meta]);

  function handleTitlebarToggleSidebar() {
    if (compactLayout) {
      setSidebarOpen((open) => !open);
      return;
    }
    setSidebarHidden((hidden) => !hidden);
  }

  function handleTitlebarFocusSearch() {
    if (compactLayout) {
      setSidebarOpen(true);
    } else if (sidebarHidden) {
      setSidebarHidden(false);
    }
    requestAnimationFrame(() => {
      document.getElementById("sidebar-search-input")?.focus();
    });
  }

  const visibleSessionError = useMemo(() => {
    if (!sessionError?.message) return "";
    if (
      sessionError.sessionId &&
      sessionError.sessionId !== currentSession?.meta.id
    ) {
      return "";
    }
    return sessionError.message;
  }, [sessionError, currentSession?.meta.id]);

  return (
    <div className="app-shell">
      <TitleBar
        title={titleBarLabel}
        settingsActive={onSettingsPage}
        onToggleSidebar={handleTitlebarToggleSidebar}
        onFocusSearch={handleTitlebarFocusSearch}
        onNewChat={() => void handleNewChat()}
        onOpenSettings={() => {
          setPage("settings");
          if (compactLayout) setSidebarOpen(false);
        }}
      />
      <div
        className={`app${compactLayout ? " app-compact" : ""}${sidebarHidden ? " app-sidebar-hidden" : ""}`}
      >
      <Sidebar
        open={sidebarOpen}
        sessions={sessions}
        currentSessionId={currentSession?.meta.id}
        busyBySession={busyBySession}
        settingsActive={onSettingsPage}
        onSelect={(sessionId) => void handleSwitchSession(sessionId)}
        onDelete={(meta) => void handleDeleteSession(meta)}
        onNewChat={() => void handleNewChat()}
      />
      {compactLayout && sidebarOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          title="关闭侧栏"
          aria-label="关闭侧栏"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <main className={`main${onSettingsPage ? " main-settings" : ""}`}>
        {onSettingsPage && config ? (
          <SettingsPage
            config={config}
            onBack={() => setPage("chat")}
            onSave={saveConfig}
            onSyncProviderModels={async (providerKey, connection) => {
              if (!window.cragent?.syncProviderModels) {
                throw new Error("主进程未支持模型同步，请重启应用。");
              }
              const result = await window.cragent.syncProviderModels({ providerKey, connection });
              if (!result?.ok) {
                throw new Error(result?.error || "同步模型失败");
              }
              setConfig(result.config);
              return result;
            }}
          />
        ) : (
          <div className="chat-layout">
            <div className="chat-content-column">
            <div className="chat-history">
              {!active ? (
                <div className="empty-state">
                  <h1>有什么我能帮你的吗？</h1>
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
                  todoRuns={currentSession.meta.todoRuns}
                  busy={busy}
                  onDelete={handleDeleteMessage}
                  onOpenImage={(image) => setViewerImage(image)}
                />
              )}
              {visibleSessionError ? (
                <div
                  className="chat-error-toast"
                  role="alert"
                  onClick={clearSessionError}
                >
                  {visibleSessionError}
                </div>
              ) : null}
            </div>

            <div className="composer">
              <div className="composer-shell">
                {showSlashMenu ? (
                  <ComposerSlashMenu
                    skills={skills}
                    query={slashFilterQuery}
                    selectedIndex={slashMenuIndex}
                    skillsExpanded={skillsExpanded}
                    onSkillsExpandedChange={setSkillsExpanded}
                    onPick={applySlashPick}
                    onHoverIndex={setSlashMenuIndex}
                  />
                ) : null}
                <div
                  className={`composer-box${composerDragOver ? " composer-drag-over" : ""}${messageQueue.length ? " has-queue-toggle" : ""}`}
                  onDragEnter={(e) => {
                    if (!Array.from(e.dataTransfer?.types || []).includes("Files")) return;
                    e.preventDefault();
                    setComposerDragOver(true);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                    setComposerDragOver(true);
                  }}
                  onDragLeave={(e) => {
                    if (e.currentTarget.contains(e.relatedTarget)) return;
                    setComposerDragOver(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setComposerDragOver(false);
                    void addImagesFromFiles(e.dataTransfer?.files);
                  }}
                >
                {messageQueue.length > 0 ? (
                  <ComposerQueuePanel
                    queue={messageQueue}
                    open={queuePanelOpen}
                    onToggle={() => setQueuePanelOpen((prev) => !prev)}
                    onRemove={removeQueuedMessage}
                  />
                ) : null}
                {pendingImages.length ? (
                  <div className="composer-attachments" aria-label="待发送图片">
                    {pendingImages.map((image) => (
                      <div key={image.id} className="composer-attachment">
                        <img src={image.dataUrl} alt={image.name || "待发送图片"} />
                        <button
                          type="button"
                          className="composer-attachment-remove"
                          title="移除图片"
                          aria-label="移除图片"
                          onClick={() => removePendingImage(image.id)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <textarea
                  ref={textareaRef}
                  className="composer-input"
                  value={input}
                  rows={1}
                  onChange={(e) => setInput(e.target.value)}
                  onInput={resizeComposer}
                  onPaste={(e) => {
                    const files = Array.from(e.clipboardData?.files || []).filter((file) =>
                      file.type.startsWith("image/"),
                    );
                    if (!files.length) return;
                    e.preventDefault();
                    void addImagesFromFiles(files);
                  }}
                  placeholder="发消息..."
                  onKeyDown={(e) => {
                    if (showSlashMenu && slashNavItems.length) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setSlashMenuIndex((prev) => Math.min(prev + 1, slashNavItems.length - 1));
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setSlashMenuIndex((prev) => Math.max(prev - 1, 0));
                        return;
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setInput("");
                        return;
                      }
                      if (e.key === "Tab" || (e.key === "Enter" && !e.altKey && !e.shiftKey)) {
                        e.preventDefault();
                        activateSlashMenuItem(slashNavItems[slashMenuIndex]);
                        return;
                      }
                    }
                    if (e.key === "Enter" && !e.altKey && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                />
                <div className="composer-toolbar-spacer" aria-hidden="true" />
                <div className="composer-toolbar">
                  <ComposerAuthMenu
                    authMode={currentSession?.meta?.authMode}
                    onChange={(mode) => void handleAuthModeChange(mode)}
                  />
                  <div className="composer-toolbar-right">
                  <label className="composer-model-wrap">
                    <span className="composer-model-content">
                      <span className="composer-model-sizer" aria-hidden="true">
                        {modelDisplay}
                      </span>
                      <span className="composer-model-label">{modelDisplay}</span>
                    </span>
                    <span className="composer-model-chevron" aria-hidden="true">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path
                          d="M3 4.5L6 7.5L9 4.5"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    <select
                      className="composer-model"
                      value={modelDisplay}
                      onChange={(e) => {
                        const nextModel = e.target.value;
                        setModelDisplay(nextModel);
                        void handleModelChange(nextModel);
                        requestAnimationFrame(() => {
                          textareaRef.current?.focus();
                        });
                      }}
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
                  </label>
                  <div className="composer-context-wrap">
                    <ComposerContextRing
                      buttonRef={contextRingRef}
                      percent={contextUsage?.percent ?? 0}
                      className={
                        contextUsage?.isAboveAutoCompactThreshold
                          ? "composer-context-ring-critical"
                          : contextUsage?.isAboveWarningThreshold
                            ? "composer-context-ring-warning"
                            : ""
                      }
                      onClick={() => setContextPopupOpen((prev) => !prev)}
                    />
                    <ComposerContextPopup
                      open={contextPopupOpen}
                      usage={contextUsage}
                      anchorRef={contextRingRef}
                      onClose={() => setContextPopupOpen(false)}
                    />
                  </div>
                  <button
                    type="button"
                    className={`composer-send${
                      busy
                        ? " composer-send-stop"
                        : canSend
                          ? " composer-send-ready"
                          : ""
                    }`}
                    onClick={() => (busy ? void handleCancelRun() : void handleSend())}
                    disabled={!busy && !canSend}
                    title={busy ? "中断当前任务" : "发送"}
                    aria-label={busy ? "中断当前任务" : "发送"}
                  >
                    {busy ? (
                      <span className="composer-send-stop-icon" aria-hidden="true" />
                    ) : (
                      <svg
                        className="composer-send-arrow"
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M12 19V5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <path
                          d="m7 10 5-5 5 5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </button>
                  </div>
                </div>
                </div>
              </div>
            </div>
            </div>
          </div>
        )}
      </main>
      </div>
      {confirmRequest ? (
        <ConfirmDialog
          title={confirmRequest.title}
          message={confirmRequest.message}
          detail={confirmRequest.detail}
          confirmLabel={confirmRequest.confirmLabel}
          cancelLabel={confirmRequest.cancelLabel}
          destructive={confirmRequest.destructive}
          onClose={(confirmed) => {
            confirmRequest.resolve(confirmed);
            setConfirmRequest(null);
          }}
        />
      ) : null}
      {viewerImage ? (
        <ImageViewer
          src={viewerImage.dataUrl}
          onClose={() => setViewerImage(null)}
        />
      ) : null}
    </div>
  );
}
