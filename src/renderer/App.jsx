import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChatView } from "./ChatView.jsx";
import { ComposerAuthMenu, ComposerMenuCheckIcon } from "./ComposerAuthMenu.jsx";
import { ComposerModelMenu } from "./ComposerModelMenu.jsx";
import { ComposerContextRing } from "./ComposerContextRing.jsx";
import { ComposerContextPopup } from "./ComposerContextPopup.jsx";
import { ComposerQueuePanel } from "./ComposerQueuePanel.jsx";
import { ComposerTaskStatus } from "./ComposerTaskStatus.jsx";
import { ComposerHookLog } from "./ComposerHookLog.jsx";
import {
  buildSlashMenuNavItems,
  ComposerSlashMenu,
  filterSlashCommands,
  filterSlashSkills,
} from "./ComposerSlashMenu.jsx";
import { ComposerAtMenu } from "./ComposerAtMenu.jsx";
import { ComposerProjectPicker } from "./ComposerProjectPicker.jsx";
import { ComposerSegmentedInput } from "./ComposerSegmentedInput.jsx";
import { useFileIcons } from "./useFileIcons.js";
import { resolveProjectFilePath } from "@shared/projectPaths.js";
import {
  getComposerEditorCaretOffset,
  getComposerFileBeforeSelection,
  getComposerMentionBeforeSelection,
  placeComposerCaretAtEnd,
  placeComposerCaretAtOffset,
} from "@shared/composerEditor.js";
import {
  atMentionFileName,
  buildAtNavItems,
  buildInputWithAtMentions,
  filterDirectoryEntries,
  isActiveManualAtMention,
  isAtSignKey,
  parentRelativePath,
  parseActiveAtMention,
  splitAtQueryPath,
} from "@shared/atMention.js";
import { Sidebar } from "./Sidebar.jsx";
import { SettingsPage } from "./SettingsPage.jsx";
import { ConfirmDialog } from "./ConfirmDialog.jsx";
import { PlanApprovalDialog } from "./PlanApprovalDialog.jsx";
import { ImageViewer } from "./ImageViewer.jsx";
import { TitleBar } from "./TitleBar.jsx";
import { shouldAutoSwitchToChatPage } from "./appNavigation.js";
import { sessionShowsLoadOlder } from "./sessionUi.js";
import { displayTitle } from "./sidebarUtils.js";
import {
  isDefaultSessionTitle,
  sessionHasUserMessages,
  titleFromFirstUserMessage,
} from "@shared/sessionTitle";
import { parseActiveSlashCommand, isActiveManualSlashCommand, isSlashKey } from "@shared/chatCommands.js";
import { collectMessageIdsForDeletion } from "@shared/chatMessages";
import { filesToImageAttachments, toStoredImages } from "@shared/chatImages";
import {
  estimateSessionContextBreakdown,
  reconcileContextBreakdownCategories,
} from "@shared/tokenEstimator";
import {
    estimateMcpToolDefinitionTokens,
    getEnabledMcpServers,
} from "@shared/mcpConfig.js";
import { formatModelRef, parseModelRef } from "@shared/modelRef.js";
import { filterVisibleTodoRuns, msUntilTodoRunsHide } from "@shared/todoRunsDisplay.js";
import { DEFAULT_UI_MESSAGE_PAGE } from "@shared/sessionPaging.js";
import {
  mergeAppendedMessagePreview,
  mergePreservedMessageImages,
} from "@shared/sessionForUi.js";
import { normalizeExecutionMode } from "@shared/executionMode.js";
import {
  getEffectiveColorScheme,
  readStoredColorScheme,
  toggleColorScheme,
} from "@shared/colorScheme.js";

const COMPOSER_LINE_HEIGHT = 24;
const COMPOSER_MIN_HEIGHT = COMPOSER_LINE_HEIGHT;
/** ~3 行可视高度，达到 2 倍后出现滚动条 */
const COMPOSER_BASE_HEIGHT = COMPOSER_LINE_HEIGHT * 3;
const COMPOSER_MAX_HEIGHT = COMPOSER_BASE_HEIGHT * 2;

const SIDEBAR_WIDTH_STORAGE_KEY = "cragent.sidebarWidth";
const SIDEBAR_WIDTH_MIN = 200;
const SIDEBAR_WIDTH_MAX = 520;
const SIDEBAR_WIDTH_DEFAULT = 260;

function readStoredSidebarWidth() {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    const value = Number(raw);
    if (!Number.isFinite(value)) return SIDEBAR_WIDTH_DEFAULT;
    return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, value));
  } catch {
    return SIDEBAR_WIDTH_DEFAULT;
  }
}

function sortSessions(sessions) {
  return [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function sessionMessagesEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i].id !== right[i].id) return false;
  }
  return true;
}

export function App() {
  const [colorScheme, setColorScheme] = useState(() => getEffectiveColorScheme());
  const [projects, setProjects] = useState([]);
  const [expandedProjectIds, setExpandedProjectIds] = useState([]);
  const [focusedProjectId, setFocusedProjectId] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [currentSession, setCurrentSession] = useState(null);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [config, setConfig] = useState(null);
  const [skills, setSkills] = useState([]);
  const [input, setInput] = useState("");
  const [composerCaret, setComposerCaret] = useState(0);
  const [atMentionManualStart, setAtMentionManualStart] = useState(null);
  const [slashCommandManualStart, setSlashCommandManualStart] = useState(null);
  const [pendingImages, setPendingImages] = useState([]);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [pendingAtMentions, setPendingAtMentions] = useState([]);
  const [composerDragOver, setComposerDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyBySession, setBusyBySession] = useState({});
  const [unreadBySession, setUnreadBySession] = useState({});
  const [page, setPage] = useState("chat");
  const [sessionError, setSessionError] = useState(null);
  const [compactLayout, setCompactLayout] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(readStoredSidebarWidth);
  const [confirmRequest, setConfirmRequest] = useState(null);
  const [planApprovalRequest, setPlanApprovalRequest] = useState(null);
  const [viewerImage, setViewerImage] = useState(null);
  const [messageQueue, setMessageQueue] = useState([]);
  const [queuePanelOpen, setQueuePanelOpen] = useState(false);
  const [contextPopupOpen, setContextPopupOpen] = useState(false);
  const [contextDetail, setContextDetail] = useState(null);
  const [sessionContextUsage, setSessionContextUsage] = useState(null);
  const [executionModeSaving, setExecutionModeSaving] = useState(false);
  const [composerQuickMenuOpen, setComposerQuickMenuOpen] = useState(false);
  const [todoRunsHideTick, setTodoRunsHideTick] = useState(0);
  const contextRingRef = useRef(null);
  const contextDetailRequestRef = useRef(0);
  const sessionContextUsageRequestRef = useRef(0);
  const composerQuickMenuRef = useRef(null);
  const filePickerRef = useRef(null);
  const sessionIdRef = useRef(null);
  const pageRef = useRef(page);
  const sessionErrorTimerRef = useRef(null);
  const composerInputRowRef = useRef(null);
  const textareaRef = useRef(null);
  const composerFocusAtEndRef = useRef(false);
  const composerFocusAtCaretRef = useRef(null);
  const composerAttachSeqRef = useRef(0);

  function nextComposerAttachSeq() {
    composerAttachSeqRef.current += 1;
    return composerAttachSeqRef.current;
  }
  const busyBySessionRef = useRef(new Map());
  const newChatInFlightRef = useRef(false);
  const sidebarWidthRef = useRef(sidebarWidth);

  const askConfirm = useCallback((options) => {
    return new Promise((resolve) => {
      setConfirmRequest({ ...options, resolve });
    });
  }, []);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  const handleSidebarResizePointerDown = useCallback(
    (event) => {
      if (compactLayout || sidebarHidden) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = sidebarWidthRef.current;
      const target = event.currentTarget;

      const onPointerMove = (moveEvent) => {
        const next = Math.min(
          SIDEBAR_WIDTH_MAX,
          Math.max(SIDEBAR_WIDTH_MIN, startWidth + moveEvent.clientX - startX),
        );
        setSidebarWidth(next);
      };

      const onPointerUp = () => {
        target.releasePointerCapture?.(event.pointerId);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
        document.body.classList.remove("app-sidebar-resizing");
        try {
          localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidthRef.current));
        } catch {
          /* ignore quota / private mode */
        }
      };

      target.setPointerCapture?.(event.pointerId);
      document.body.classList.add("app-sidebar-resizing");
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    },
    [compactLayout, sidebarHidden],
  );

  const visibleTodoRuns = useMemo(
    () => filterVisibleTodoRuns(currentSession?.meta?.todoRuns),
    [currentSession?.meta?.todoRuns, todoRunsHideTick],
  );

  const verboseThinking = Boolean(config?.ui?.verbose_thinking);
  const [hookLogs, setHookLogs] = useState([]);

  useEffect(() => {
    const delay = msUntilTodoRunsHide(currentSession?.meta?.todoRuns);
    if (delay === null) {
      return undefined;
    }
    const timer = setTimeout(() => setTodoRunsHideTick((value) => value + 1), delay + 50);
    return () => clearTimeout(timer);
  }, [currentSession?.meta?.todoRuns, todoRunsHideTick]);

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
      setProjects(Array.isArray(snapshot.projects) ? snapshot.projects : []);
      const sorted = sortSessions(snapshot.sessions);
      setSessions(sorted);
      const sessionId = snapshot.currentSessionId || sorted[0]?.id;
      if (!sessionId) {
        showSessionError("没有可用会话。");
        return;
      }
      const session = await window.cragent.getSession(sessionId, {
        messageLimit: DEFAULT_UI_MESSAGE_PAGE,
      });
      setCurrentSession(session);
      setFocusedProjectId(session?.meta?.projectId ?? null);
      ensureProjectExpanded(session?.meta?.projectId);
    } catch (err) {
      showSessionError(err instanceof Error ? err.message : String(err));
    }
  }

  const loadOlderMessages = useCallback(async () => {
    if (!currentSession?.messages?.length || loadingOlderMessages) {
      return;
    }
    const sessionId = currentSession.meta.id;
    const oldestId = currentSession.messages[0].id;
    setLoadingOlderMessages(true);
    try {
      const chunk = await window.cragent.getSession(sessionId, {
        beforeMessageId: oldestId,
        messageLimit: DEFAULT_UI_MESSAGE_PAGE,
      });
      setCurrentSession((prev) => {
        if (!prev || prev.meta.id !== sessionId || prev.meta.id !== chunk.meta.id) {
          return prev;
        }
        return {
          meta: {
            ...prev.meta,
            hasMoreMessages: chunk.meta.hasMoreMessages,
            messageCount: chunk.meta.messageCount ?? prev.meta.messageCount,
          },
          messages: [...chunk.messages, ...prev.messages],
        };
      });
    } catch (err) {
      showSessionError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingOlderMessages(false);
    }
  }, [currentSession, loadingOlderMessages, showSessionError]);

  function ensureProjectExpanded(projectId) {
    if (!projectId) return;
    setExpandedProjectIds((prev) => (prev.includes(projectId) ? prev : [...prev, projectId]));
  }

  function toggleProjectExpanded(projectId) {
    setExpandedProjectIds((prev) =>
      prev.includes(projectId) ? prev.filter((id) => id !== projectId) : [...prev, projectId],
    );
  }

  useEffect(() => {
    sessionIdRef.current = currentSession?.meta.id ?? null;
    setLoadingOlderMessages(false);
  }, [currentSession?.meta.id]);

  useLayoutEffect(() => {
    pageRef.current = page;
  }, [page]);

  useEffect(() => () => clearSessionError(), [clearSessionError]);

  function resizeComposer() {
    const inputs =
      composerInputRowRef.current?.querySelectorAll(".composer-input") ??
      (textareaRef.current ? [textareaRef.current] : []);
    let maxScrollHeight = 0;
    for (const el of inputs) {
      el.style.height = "0px";
      maxScrollHeight = Math.max(maxScrollHeight, el.scrollHeight);
    }
    const next = Math.min(COMPOSER_MAX_HEIGHT, Math.max(COMPOSER_MIN_HEIGHT, maxScrollHeight));
    const overflowY = maxScrollHeight > COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
    for (const el of inputs) {
      el.style.height = `${next}px`;
      el.style.overflowY = overflowY;
    }
  }

  function updateComposerInput(nextInput, nextMentions = pendingAtMentions, caret, nextFiles) {
    setInput(nextInput);
    if (nextMentions !== pendingAtMentions) {
      setPendingAtMentions(nextMentions);
    }
    if (nextFiles !== undefined) {
      setPendingFiles(nextFiles);
    }
    setComposerCaret(
      typeof caret === "number" && Number.isFinite(caret)
        ? Math.max(0, Math.min(caret, nextInput.length))
        : nextInput.length,
    );
  }

  function focusPrimaryComposerEnd() {
    const el = textareaRef.current;
    if (!el) return false;
    el.focus({ preventScroll: true });
    if (el.isContentEditable) {
      placeComposerCaretAtEnd(el);
      return true;
    }
    const pos = el.value.length;
    el.setSelectionRange(pos, pos);
    return true;
  }

  function requestComposerFocusAtEnd() {
    composerFocusAtEndRef.current = true;
  }

  function requestComposerFocusAtCaret(offset) {
    composerFocusAtCaretRef.current =
      typeof offset === "number" && Number.isFinite(offset) ? Math.max(0, offset) : 0;
  }

  function focusPrimaryComposerAtCaret(offset) {
    const el = textareaRef.current;
    if (!el) return false;
    el.focus({ preventScroll: true });
    if (el.isContentEditable) {
      placeComposerCaretAtOffset(el, offset);
      return true;
    }
    const pos = Math.max(0, Math.min(offset, el.value?.length ?? 0));
    el.setSelectionRange(pos, pos);
    return true;
  }

  useLayoutEffect(() => {
    if (composerFocusAtCaretRef.current === null) return;
    const offset = composerFocusAtCaretRef.current;
    if (focusPrimaryComposerAtCaret(offset)) {
      composerFocusAtCaretRef.current = null;
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (composerFocusAtCaretRef.current === null) return;
      const caret = composerFocusAtCaretRef.current;
      if (focusPrimaryComposerAtCaret(caret)) {
        composerFocusAtCaretRef.current = null;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [input, pendingAtMentions.length, pendingFiles.length, composerCaret]);

  useLayoutEffect(() => {
    if (!composerFocusAtEndRef.current) return;
    if (focusPrimaryComposerEnd()) {
      composerFocusAtEndRef.current = false;
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (!composerFocusAtEndRef.current) return;
      if (focusPrimaryComposerEnd()) {
        composerFocusAtEndRef.current = false;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [input, pendingAtMentions, currentSession?.meta?.id]);

  useLayoutEffect(() => {
    resizeComposer();
  }, [input, page, pendingImages.length, pendingFiles.length, pendingAtMentions.length]);

  useEffect(() => {
    if (!composerQuickMenuOpen) return;
    const onPointerDown = (event) => {
      if (composerQuickMenuRef.current?.contains(event.target)) return;
      setComposerQuickMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [composerQuickMenuOpen]);

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
        const existingIndex = prev.messages.findIndex((item) => item.id === message.id);
        if (existingIndex >= 0) {
          const merged = mergeAppendedMessagePreview(prev.messages[existingIndex], message);
          if (merged === prev.messages[existingIndex]) {
            return prev;
          }
          const messages = [...prev.messages];
          messages[existingIndex] = merged;
          return { ...prev, messages };
        }
        const messages = [...prev.messages, message];
        return {
          ...prev,
          messages,
          meta:
            message.role === "user"
              ? { ...prev.meta, hasUserMessages: true }
              : prev.meta,
        };
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
      const isViewing = sessionIdRef.current === session.meta.id;

      if (isViewing) {
        clearSessionError();
        ensureProjectExpanded(session?.meta?.projectId);
        setFocusedProjectId(session?.meta?.projectId ?? null);
        setCurrentSession((prev) => {
          const mergedMessages = mergePreservedMessageImages(prev?.messages, session.messages);
          if (
            prev?.meta.id === session.meta.id &&
            sessionMessagesEqual(prev.messages, mergedMessages) &&
            prev.meta.updatedAt === session.meta.updatedAt
          ) {
            const messageCount =
              session.meta.messageCount ?? prev.meta.messageCount ?? mergedMessages.length;
            const hasMoreMessages = messageCount > mergedMessages.length;
            if (
              prev.meta.hasMoreMessages === hasMoreMessages &&
              prev.meta.messageCount === messageCount
            ) {
              return prev;
            }
            return {
              ...prev,
              meta: { ...prev.meta, hasMoreMessages, messageCount },
            };
          }
          const messageCount =
            session.meta.messageCount ?? mergedMessages.length;
          return {
            ...session,
            messages: mergedMessages,
            meta: {
              ...session.meta,
              messageCount,
              hasMoreMessages: messageCount > mergedMessages.length,
            },
          };
        });
        // Keep Settings open when the current session refreshes in the background.
        if (shouldAutoSwitchToChatPage(pageRef.current, isViewing)) {
          setPage("chat");
        }
      }

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
      setBusyBySession((prev) => {
        const wasBusy = prev[sessionId];
        if (wasBusy && !nextBusy && sessionIdRef.current !== sessionId) {
          setUnreadBySession((unread) => ({ ...unread, [sessionId]: true }));
        }
        return { ...prev, [sessionId]: nextBusy };
      });
      if (sessionIdRef.current === sessionId) {
        setBusy(nextBusy);
      }
    });

    const offTodos = window.cragent.onTodosChanged?.(({ sessionId, todoRuns, todos }) => {
      setCurrentSession((prev) => {
        if (!prev || prev.meta.id !== sessionId) return prev;
        return {
          ...prev,
          meta: {
            ...prev.meta,
            todos: todos ?? prev.meta.todos,
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

    const offPlanApproval = window.cragent.onPlanApprovalRequest?.((payload) => {
      setPlanApprovalRequest({
        displayPath: payload.displayPath,
        content: payload.content,
        resolve: (result) => {
          window.cragent.respondPlanApproval?.({
            id: payload.id,
            approved: Boolean(result?.approved),
            cancelled: Boolean(result?.cancelled),
            dismissed: Boolean(result?.dismissed),
            rejected: Boolean(result?.rejected),
            content: result?.content,
            feedback: result?.feedback,
          });
        },
      });
    });

    const offError = window.cragent.onError(({ message, sessionId }) => {
      if (!sessionId || sessionIdRef.current === sessionId) {
        showSessionError(message, sessionId);
      }
      if (sessionId) {
        busyBySessionRef.current.set(sessionId, false);
        setBusyBySession((prev) => {
          const wasBusy = prev[sessionId];
          if (wasBusy && sessionIdRef.current !== sessionId) {
            setUnreadBySession((unread) => ({ ...unread, [sessionId]: true }));
          }
          return { ...prev, [sessionId]: false };
        });
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

    const offHookLog = window.cragent.onHookLog?.((payload) => {
      if (sessionIdRef.current === payload.sessionId) {
        setHookLogs(payload.logs || []);
      }
    });

    return () => {
      offMessage();
      offSession();
      offBusy();
      offTodos?.();
      offQueue?.();
      offConfirm?.();
      offPlanApproval?.();
      offError();
      offSettings();
      offHookLog?.();
    };
  }, []);

  useEffect(() => {
    if (readStoredColorScheme()) return undefined;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setColorScheme(getEffectiveColorScheme());
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const sessionId = currentSession?.meta?.id;
    if (!sessionId || !window.cragent.getHookLogs) {
      setHookLogs([]);
      return;
    }
    void window.cragent.getHookLogs(sessionId).then((logs) => {
      if (sessionIdRef.current === sessionId) {
        setHookLogs(Array.isArray(logs) ? logs : []);
      }
    });
  }, [currentSession?.meta?.id]);

  useEffect(() => {
    if (!busy) {
      void refreshSkills();
    }
  }, [busy, refreshSkills]);

  const currentModel = useMemo(() => {
    if (!config || !currentSession) return "";
    return formatModelRef(currentSession.meta.providerKey, currentSession.meta.modelId);
  }, [config, currentSession]);

  useEffect(() => {
    setContextDetail(null);
    setSessionContextUsage(null);
  }, [currentSession?.meta?.id]);

  useEffect(() => {
    const sessionId = currentSession?.meta?.id;
    if (!sessionId || !window.cragent?.getSessionContextDetail) {
      return undefined;
    }

    const requestId = ++sessionContextUsageRequestRef.current;
    void window.cragent.getSessionContextDetail(sessionId).then((detail) => {
      if (
        requestId !== sessionContextUsageRequestRef.current ||
        sessionIdRef.current !== sessionId
      ) {
        return;
      }
      setSessionContextUsage({ sessionId, ...detail });
    }).catch(() => {
      if (
        requestId === sessionContextUsageRequestRef.current &&
        sessionIdRef.current === sessionId
      ) {
        setSessionContextUsage(null);
      }
    });
    return undefined;
  }, [
    currentSession?.meta?.id,
    currentSession?.meta?.providerKey,
    currentSession?.meta?.modelId,
    currentSession?.meta?.executionMode,
  ]);

  const contextUsage = useMemo(() => {
    if (!currentSession || !config) return null;
    const sessionId = currentSession.meta.id;
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
    const mcpServers = getEnabledMcpServers(config);
    const mcpTokens =
      agentTools.enable_mcp !== false
        ? estimateMcpToolDefinitionTokens(mcpServers.length > 0 ? mcpServers.length * 2 : 0)
        : 0;
    const estimated = estimateSessionContextBreakdown(currentSession, model, {
      compactBufferTokens: compactBuffer,
      autoCompactThresholdPercent: config.context?.auto_compact_threshold_percent,
      agentTools,
      skillsCatalogText,
      mcpTokens,
    });
    const storedUsage =
      sessionContextUsage?.sessionId === sessionId ? sessionContextUsage : null;
    if (!storedUsage?.categories?.length) {
      return estimated;
    }
    return {
      ...estimated,
      categories: reconcileContextBreakdownCategories(
        storedUsage.categories,
        estimated.tokens,
      ),
    };
  }, [currentSession, config, skills, sessionContextUsage]);

  const refreshContextDetail = useCallback(async () => {
    const sessionId = currentSession?.meta?.id;
    if (!sessionId || !window.cragent?.getSessionContextDetail) {
      return;
    }
    const requestId = ++contextDetailRequestRef.current;
    try {
      const detail = await window.cragent.getSessionContextDetail(sessionId);
      if (
        requestId !== contextDetailRequestRef.current ||
        sessionIdRef.current !== sessionId
      ) {
        return;
      }
      setContextDetail(detail);
      setSessionContextUsage({ sessionId, ...detail });
    } catch {
      if (requestId === contextDetailRequestRef.current) {
        setContextDetail(null);
      }
    }
  }, [currentSession?.meta?.id]);

  const closeContextPopup = useCallback(() => {
    setContextPopupOpen(false);
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!contextPopupOpen) {
      setContextDetail(null);
      return;
    }
    void refreshContextDetail();
  }, [
    contextPopupOpen,
    refreshContextDetail,
    currentSession?.messages?.length,
    currentSession?.meta?.updatedAt,
    currentSession?.meta?.todos,
    currentSession?.meta?.llmContextDividerId,
    currentSession?.meta?.contextSummary,
    currentSession?.meta?.postCompactContext,
    currentSession?.meta?.sessionMemory,
    skills,
    config?.context?.compact_buffer_tokens,
    config?.context?.auto_compact_threshold_percent,
    config?.agents,
    config?.mcp,
  ]);

  const contextUsageForPopup = useMemo(() => {
    if (!contextUsage) return null;
    if (!contextDetail?.categories?.length) {
      return contextUsage;
    }
    return {
      ...contextDetail,
      percent: contextUsage.percent,
      isAboveWarningThreshold: contextUsage.isAboveWarningThreshold,
      isAboveAutoCompactThreshold: contextUsage.isAboveAutoCompactThreshold,
      isAtBlockingLimit: contextUsage.isAtBlockingLimit,
    };
  }, [contextUsage, contextDetail]);

  const slashMention = useMemo(() => parseActiveSlashCommand(input), [input]);
  const slashQuery = slashMention ? slashMention.query.toLowerCase() : null;

  const atMention = useMemo(() => parseActiveAtMention(input, composerCaret), [input, composerCaret]);

  useEffect(() => {
    if (!atMention) {
      setAtMentionManualStart(null);
    }
  }, [atMention]);

  useEffect(() => {
    if (!slashMention) {
      setSlashCommandManualStart(null);
    }
  }, [slashMention]);

  const activeProject = useMemo(() => {
    const projectId = currentSession?.meta?.projectId;
    if (!projectId) return null;
    return projects.find((project) => project.id === projectId) || null;
  }, [currentSession?.meta?.projectId, projects]);

  const active = Boolean(currentSession && currentSession.messages.length > 0);
  const hasComposerDraft =
    input.length > 0 ||
    pendingImages.length > 0 ||
    pendingFiles.length > 0 ||
    pendingAtMentions.length > 0;

  const showComposerProjectPicker = useMemo(() => {
    if (!currentSession || page !== "chat") return false;
    if (!isDefaultSessionTitle(currentSession.meta.title)) return false;
    if (currentSession.meta.hasUserMessages) return false;
    if (sessionHasUserMessages(currentSession.messages)) return false;
    if (hasComposerDraft || busy) return false;
    return true;
  }, [currentSession, page, hasComposerDraft, busy]);

  const composerProjectLabel = useMemo(() => {
    if (activeProject?.name) return activeProject.name;
    return "选择项目";
  }, [activeProject?.name]);

  const atPathParts = useMemo(() => {
    if (!atMention) return { relativePath: "", filter: "" };
    return splitAtQueryPath(atMention.query);
  }, [atMention]);

  const [atBrowseRelativePath, setAtBrowseRelativePath] = useState("");
  const [atDirEntries, setAtDirEntries] = useState([]);
  const [atDirLoading, setAtDirLoading] = useState(false);
  const [atDirError, setAtDirError] = useState("");
  const [atMenuIndex, setAtMenuIndex] = useState(0);
  const [atMenuExpanded, setAtMenuExpanded] = useState(false);
  const atMentionWasActiveRef = useRef(false);
  const atPickContextRef = useRef(null);

  const composerIconPaths = useMemo(() => {
    const paths = [];
    for (const file of pendingFiles) {
      const path = file.path?.trim();
      if (path) paths.push(path);
    }
    const projectDir = activeProject?.directoryPath || "";
    for (const mention of pendingAtMentions) {
      const path = resolveProjectFilePath(projectDir, mention.relativePath);
      if (path) paths.push(path);
    }
    for (const entry of atDirEntries) {
      const path = resolveProjectFilePath(projectDir, entry.relativePath);
      if (path) paths.push(path);
    }
    if (projectDir) {
      paths.push(projectDir);
    }
    return paths;
  }, [pendingFiles, pendingAtMentions, atDirEntries, activeProject?.directoryPath]);

  const composerFileIcons = useFileIcons(composerIconPaths);

  useEffect(() => {
    if (!atMention) {
      setAtBrowseRelativePath("");
      setAtDirEntries([]);
      setAtDirError("");
      atMentionWasActiveRef.current = false;
      return;
    }

    const query = atMention.query;
    const justOpened = !atMentionWasActiveRef.current;
    atMentionWasActiveRef.current = true;

    // Sync browse path from typed `@path/to/filter` only when the menu opens or the
    // user types a slash path. Click-navigation updates browse state directly and
    // must not be reset when the query is a plain filter with no `/`.
    if (justOpened || query.includes("/")) {
      setAtBrowseRelativePath(splitAtQueryPath(query).relativePath);
    }
  }, [atMention]);

  useEffect(() => {
    setAtMenuIndex(0);
    setAtMenuExpanded(false);
  }, [atMention?.query, atBrowseRelativePath]);

  useEffect(() => {
    if (!atMention || !activeProject?.id) {
      setAtDirEntries([]);
      setAtDirLoading(false);
      setAtDirError("");
      return;
    }
    let cancelled = false;
    setAtDirLoading(true);
    setAtDirError("");
    window.cragent
      .listProjectDirectory({
        projectId: activeProject.id,
        relativePath: atBrowseRelativePath,
      })
      .then((result) => {
        if (cancelled) return;
        setAtDirEntries(Array.isArray(result?.entries) ? result.entries : []);
        setAtDirError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setAtDirEntries([]);
        setAtDirError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setAtDirLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [atMention, activeProject?.id, atBrowseRelativePath]);

  const atFilteredEntries = useMemo(
    () => filterDirectoryEntries(atDirEntries, atPathParts.filter),
    [atDirEntries, atPathParts.filter],
  );

  const atNavItems = useMemo(() => {
    if (!atMention) return [];
    return buildAtNavItems(
      atFilteredEntries,
      atBrowseRelativePath,
      Boolean(atBrowseRelativePath),
    );
  }, [atMention, atFilteredEntries, atBrowseRelativePath]);

  useEffect(() => {
    if (!atNavItems.length) {
      setAtMenuIndex(0);
      return;
    }
    if (atMenuIndex >= atNavItems.length) {
      setAtMenuIndex(0);
    }
  }, [atNavItems, atMenuIndex]);

  const canSend =
    Boolean(input.trim()) ||
    pendingImages.length > 0 ||
    pendingFiles.length > 0 ||
    pendingAtMentions.length > 0;

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

  const showSlashMenu =
    page === "chat" &&
    slashQuery !== null &&
    isActiveManualSlashCommand(slashMention, slashCommandManualStart);
  const showAtMenu =
    page === "chat" &&
    atMention !== null &&
    isActiveManualAtMention(atMention, atMentionManualStart) &&
    Boolean(activeProject?.id) &&
    !showSlashMenu;

  useEffect(() => {
    if (showAtMenu && atMention) {
      atPickContextRef.current = { atMention, inputSnapshot: input, caretSnapshot: composerCaret };
      return;
    }
    if (!showAtMenu) {
      atPickContextRef.current = null;
    }
  }, [showAtMenu, atMention, input, composerCaret]);
  const sendButtonDisabled = !busy && !canSend;

  function noteManualComposerTriggerStart(event, segment) {
    const el = event.currentTarget;
    const caret = segment?.contentEditable
      ? getComposerEditorCaretOffset(el)
      : (el?.selectionStart ?? 0);

    if (isSlashKey(event)) {
      setSlashCommandManualStart(caret);
      setAtMentionManualStart(null);
      return;
    }
    if (isAtSignKey(event)) {
      setAtMentionManualStart(caret);
      setSlashCommandManualStart(null);
    }
  }

  function noteComposerTextPaste() {
    setAtMentionManualStart(null);
    setSlashCommandManualStart(null);
  }

  function replaceActiveAtMention(nextMentionBody) {
    if (!atMention) return;
    const prefix = input.slice(0, atMention.mentionStart);
    const suffix = input.slice(atMention.mentionEnd);
    const body = String(nextMentionBody ?? "");
    const next = `${prefix}@${body}${suffix}`;
    setInput(next);
    setComposerCaret(atMention.mentionStart + 1 + body.length);
    requestComposerFocusAtEnd();
  }

  function applyAtFilePick(relativePath) {
    const cleanPath = String(relativePath ?? "").trim();
    if (!cleanPath) return;

    const pickContext = atPickContextRef.current;
    const pickCaret = pickContext?.caretSnapshot ?? composerCaret;
    const useLiveInput = parseActiveAtMention(input, pickCaret);
    const sourceInput = useLiveInput ? input : (pickContext?.inputSnapshot ?? input);
    const sourceCaret = useLiveInput ? pickCaret : (pickContext?.caretSnapshot ?? composerCaret);
    const activeAt =
      parseActiveAtMention(sourceInput, sourceCaret) ??
      atMention ??
      pickContext?.atMention ??
      null;
    if (!activeAt) return;

    const mentionStart = activeAt.mentionStart;
    let nextInput = `${sourceInput.slice(0, activeAt.mentionStart)}${sourceInput.slice(activeAt.mentionEnd)}`;
    const name = atMentionFileName(cleanPath);
    const nextMentions = pendingAtMentions.some((mention) => mention.relativePath === cleanPath)
      ? pendingAtMentions
      : [
          ...pendingAtMentions,
          { id: crypto.randomUUID(), name, relativePath: cleanPath, insertAt: mentionStart, attachSeq: nextComposerAttachSeq() },
        ];
    updateComposerInput(nextInput, nextMentions);
    atPickContextRef.current = null;
    requestComposerFocusAtEnd();
  }

  function enterAtDirectory(relativePath) {
    setAtBrowseRelativePath(relativePath);
    if (atMention?.query) {
      replaceActiveAtMention("");
    }
  }

  function goAtParentDirectory() {
    const parent = parentRelativePath(atBrowseRelativePath);
    setAtBrowseRelativePath(parent);
    if (atMention?.query) {
      replaceActiveAtMention("");
    }
  }

  function activateAtMenuItem(item) {
    if (!item) return;
    if (item.kind === "parent") {
      goAtParentDirectory();
      return;
    }
    applyAtFilePick(item.entry.relativePath);
  }

  function applySlashPick(name) {
    const replacement = `/${name} `;
    const next = slashMention
      ? `${input.slice(0, slashMention.slashStart)}${replacement}${input.slice(slashMention.slashEnd)}`
      : replacement;
    setInput(next);
    requestComposerFocusAtEnd();
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

  async function addFilesFromPicker(fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;
    const imageFiles = files.filter((file) => file.type?.startsWith("image/"));
    const normalFiles = files.filter((file) => !file.type?.startsWith("image/"));
    if (imageFiles.length) {
      const { accepted, errors } = await filesToImageAttachments(imageFiles, pendingImages.length);
      if (accepted.length) {
        setPendingImages((prev) => [...prev, ...accepted]);
      }
      if (errors.length) {
        showSessionError(errors[0], currentSession?.meta.id);
      }
    }
    if (normalFiles.length) {
      const editor = textareaRef.current;
      const insertAt =
        editor?.isContentEditable
          ? getComposerEditorCaretOffset(editor)
          : typeof composerCaret === "number" && Number.isFinite(composerCaret)
            ? composerCaret
            : input.length;
      setPendingFiles((prev) => {
        const seen = new Set(
          prev.map((item) => `${item.path || item.name}:${item.size}`),
        );
        const appended = normalFiles
          .map((file) => ({
            id: crypto.randomUUID(),
            name: file.name || "file",
            size: Number(file.size || 0),
            path: typeof file.path === "string" ? file.path : "",
            insertAt,
            attachSeq: nextComposerAttachSeq(),
          }))
          .filter((item) => {
            const key = `${item.path || item.name}:${item.size}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        return [...prev, ...appended];
      });
    }
  }

  function removePendingImage(imageId) {
    setPendingImages((prev) => prev.filter((image) => image.id !== imageId));
  }

  function removePendingFile(fileId) {
    const target = pendingFiles.find((file) => file.id === fileId);
    if (target) {
      const at = target.insertAt ?? input.length;
      setComposerCaret(at);
      requestComposerFocusAtCaret(at);
    }
    setPendingFiles((prev) => prev.filter((file) => file.id !== fileId));
  }

  async function handleAddProjectDirectory(directoryPath) {
    const cleanPath = String(directoryPath || "").trim();
    if (!cleanPath) return null;
    try {
      const project = await window.cragent.addProject(cleanPath);
      setProjects((prev) => {
        if (prev.some((item) => item.id === project.id)) {
          return prev;
        }
        return [...prev, project].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
      });
      ensureProjectExpanded(project.id);
      return project;
    } catch (err) {
      showSessionError(err instanceof Error ? err.message : String(err), currentSession?.meta?.id);
      return null;
    }
  }

  async function handleRemoveProject(project) {
    const name = project?.name || "此项目";
    const confirmed = await askConfirm({
      message: `删除「${name}」？`,
      detail: "将从 projects.json 移除该项目，并删除 Projects 目录下与项目 ID 同名的文件夹（含全部会话）。此操作无法撤销。",
      confirmLabel: "删除",
      cancelLabel: "取消",
      destructive: true,
    });
    if (!confirmed) return;
    if (!window.cragent?.removeProject) {
      showSessionError("无法删除项目，请完全退出并重启 CRAgent。", currentSession?.meta?.id);
      return;
    }
    try {
      const result = await window.cragent.removeProject(project.id);
      const deletedIds = new Set(result?.deletedSessionIds || []);
      setProjects((prev) => prev.filter((item) => item.id !== project.id));
      setExpandedProjectIds((prev) => prev.filter((id) => id !== project.id));
      if (focusedProjectId === project.id) {
        setFocusedProjectId(null);
      }
      setUnreadBySession((prev) => {
        if (!deletedIds.size) return prev;
        const next = { ...prev };
        for (const sessionId of deletedIds) {
          delete next[sessionId];
        }
        return next;
      });
      const snapshot = await window.cragent.getSnapshot();
      setSessions(sortSessions(snapshot.sessions));
      if (currentSession && deletedIds.has(currentSession.meta.id)) {
        const fallbackId =
          result?.fallbackSessionId || snapshot.sessions[0]?.id || snapshot.currentSessionId;
        if (fallbackId) {
          const session = await window.cragent.getSession(fallbackId, {
            messageLimit: DEFAULT_UI_MESSAGE_PAGE,
          });
          setCurrentSession(session);
          setFocusedProjectId(session?.meta?.projectId ?? null);
          ensureProjectExpanded(session?.meta?.projectId);
          setPage("chat");
        } else {
          setCurrentSession(null);
        }
      }
    } catch (err) {
      showSessionError(err instanceof Error ? err.message : String(err), currentSession?.meta?.id);
    }
  }

  function removePendingAtMention(mentionId) {
    const target = pendingAtMentions.find((mention) => mention.id === mentionId);
    if (target) {
      const at = target.insertAt ?? input.length;
      setComposerCaret(at);
      requestComposerFocusAtCaret(at);
      setInput((prev) => {
        const tail = prev.slice(at);
        if (/^\s*$/.test(tail) && prev.slice(0, at).trim() === "") {
          return prev.slice(0, at);
        }
        return prev;
      });
    }
    setPendingAtMentions((prev) => prev.filter((mention) => mention.id !== mentionId));
  }

  function removeLastPendingAtMention() {
    if (!pendingAtMentions.length) return;
    const sorted = [...pendingAtMentions].sort(
      (a, b) => (a.insertAt ?? input.length) - (b.insertAt ?? input.length),
    );
    const last = sorted[sorted.length - 1];
    const at = last.insertAt ?? input.length;
    setComposerCaret(at);
    requestComposerFocusAtCaret(at);
    setInput((prev) => {
      const tail = prev.slice(at);
      if (/^\s*$/.test(tail) && prev.slice(0, at).trim() === "") {
        return prev.slice(0, at);
      }
      return prev;
    });
    setPendingAtMentions((prev) => prev.filter((mention) => mention.id !== last.id));
  }

  const composerPlaceholder =
    pendingAtMentions.length || pendingImages.length || pendingFiles.length ? "" : "发消息...";

  function buildSendPayload(trimmed) {
    const atMentions = pendingAtMentions.map(({ name, relativePath, insertAt }) => ({
      name,
      relativePath,
      insertAt,
    }));
    const withAtMentions = buildInputWithAtMentions(trimmed, atMentions);
    return {
      userInput: buildInputWithFiles(withAtMentions, pendingFiles),
      userText: trimmed,
      atMentions,
    };
  }

  function buildInputWithFiles(text, files) {
    if (!files.length) return text;
    const lines = files.map((file) => `- ${file.path || file.name}`);
    const fileBlock = `已附加文件：\n${lines.join("\n")}\n\n请先阅读这些文件，再继续处理当前任务。`;
    const trimmed = text.trim();
    return trimmed ? `${trimmed}\n\n${fileBlock}` : fileBlock;
  }

  async function handleSend(text = input) {
    if (!currentSession || page !== "chat") return;
    const trimmed = text.trim();
    if (!trimmed && !pendingImages.length && !pendingFiles.length && !pendingAtMentions.length) return;

    const sessionId = currentSession.meta.id;
    const images = toStoredImages(pendingImages);
    const sendPayload = buildSendPayload(trimmed);

    if (busy) {
      setComposerQuickMenuOpen(false);
      setInput("");
      setComposerCaret(0);
      setAtMentionManualStart(null);
      setSlashCommandManualStart(null);
      setPendingImages([]);
      setPendingFiles([]);
      setPendingAtMentions([]);
      composerAttachSeqRef.current = 0;
      setComposerDragOver(false);
      try {
        await window.cragent.sendChat({
          sessionId,
          userInput: sendPayload.userInput,
          userText: sendPayload.userText,
          atMentions: sendPayload.atMentions,
          images,
        });
        setQueuePanelOpen(true);
      } catch (err) {
        showSessionError(err instanceof Error ? err.message : String(err), sessionId);
      }
      return;
    }

    setInput("");
    setComposerCaret(0);
    setAtMentionManualStart(null);
    setSlashCommandManualStart(null);
    setPendingImages([]);
    setPendingFiles([]);
    setPendingAtMentions([]);
    composerAttachSeqRef.current = 0;
    setComposerQuickMenuOpen(false);
    setComposerDragOver(false);
    busyBySessionRef.current.set(sessionId, true);
    setBusyBySession((prev) => ({ ...prev, [sessionId]: true }));
    setBusy(true);

    try {
      const result = await window.cragent.sendChat({
        sessionId,
        userInput: sendPayload.userInput,
        userText: sendPayload.userText,
        atMentions: sendPayload.atMentions,
        images,
      });
      // Runtime should emit busy=false when a run completes. Keep a local fallback
      // to avoid a stuck sidebar spinner if that event is dropped/out of order.
      if (!result?.queued) {
        busyBySessionRef.current.set(sessionId, false);
        setBusyBySession((prev) => ({ ...prev, [sessionId]: false }));
        if (sessionIdRef.current === sessionId) {
          setBusy(false);
        }
      }
    } catch (err) {
      busyBySessionRef.current.set(sessionId, false);
      setBusyBySession((prev) => ({ ...prev, [sessionId]: false }));
      if (sessionIdRef.current === sessionId) {
        setBusy(false);
      }
      showSessionError(err instanceof Error ? err.message : String(err), sessionId);
    }
  }

  async function handleCancelRun() {
    if (!currentSession) return;
    const sessionId = currentSession.meta.id;
    if (confirmRequest) {
      confirmRequest.resolve(false);
      setConfirmRequest(null);
    }
    busyBySessionRef.current.set(sessionId, false);
    setBusyBySession((prev) => ({ ...prev, [sessionId]: false }));
    setBusy(false);
    await window.cragent.cancelRun?.(sessionId);
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

  function reorderQueuedMessages(fromIndex, toIndex) {
    if (!currentSession || fromIndex === toIndex) return;
    setMessageQueue((prev) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex >= prev.length
      ) {
        return prev;
      }
      const next = [...prev];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return next;
    });
    void window.cragent.reorderQueuedMessages?.({
      sessionId: currentSession.meta.id,
      fromIndex,
      toIndex,
    });
  }

  async function handleNewChat(projectId) {
    if (newChatInFlightRef.current) return;
    newChatInFlightRef.current = true;
    try {
      clearSessionError();
      const resolvedProjectId =
        projectId !== undefined
          ? projectId || null
          : focusedProjectId != null
            ? focusedProjectId
            : page === "chat" && currentSession
              ? (currentSession.meta?.projectId ?? null)
              : expandedProjectIds.length === 1
                ? expandedProjectIds[0]
                : null;
      const next = await window.cragent.newSession({ projectId: resolvedProjectId });
      setCurrentSession(next);
      setFocusedProjectId(next?.meta?.projectId ?? null);
      ensureProjectExpanded(next?.meta?.projectId);
      setSessions((prev) => {
        const has = prev.some((s) => s.id === next.meta.id);
        if (has) return sortSessions(prev);
        return sortSessions([next.meta, ...prev]);
      });
      setPage("chat");
      if (compactLayout) setSidebarOpen(false);
      requestComposerFocusAtEnd();
    } finally {
      newChatInFlightRef.current = false;
    }
  }

  function handleSelectProject(projectId) {
    if (projectId === null) {
      setFocusedProjectId(null);
      return;
    }
    setFocusedProjectId(projectId);
    toggleProjectExpanded(projectId);
  }

  async function handleSwitchSession(sessionId) {
    clearSessionError();
    sessionIdRef.current = sessionId;
    setLoadingOlderMessages(false);
    setUnreadBySession((prev) => {
      if (!prev[sessionId]) return prev;
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    const session = await window.cragent.getSession(sessionId, {
      messageLimit: DEFAULT_UI_MESSAGE_PAGE,
    });
    setCurrentSession(session);
    setFocusedProjectId(session?.meta?.projectId ?? null);
    ensureProjectExpanded(session?.meta?.projectId);
    setBusy(busyBySessionRef.current.get(sessionId) ?? false);
    setPage("chat");
    if (compactLayout) setSidebarOpen(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    });
  }

  async function handleDeleteSession(meta) {
    const confirmed = await askConfirm({
      message: "删除此会话吗？",
      detail: "删除后，这条对话记录将无法找回，其中包含的文件也将一并被删除。确定删除此对话？",
      confirmLabel: "删除",
      cancelLabel: "取消",
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    setUnreadBySession((prev) => {
      if (!prev[meta.id]) return prev;
      const next = { ...prev };
      delete next[meta.id];
      return next;
    });
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
      setFocusedProjectId(session?.meta?.projectId ?? null);
      ensureProjectExpanded(session?.meta?.projectId);
      setPage("chat");
    }
    if (compactLayout) setSidebarOpen(false);
  }

  async function handleModelChange(nextModel) {
    if (!currentSession) return;
    const next = parseModelRef(nextModel);
    if (!next) return;
    await window.cragent.updateModel({
      sessionId: currentSession.meta.id,
      providerKey: next.providerKey,
      modelId: next.modelId,
    });
  }

  const executionMode = useMemo(() => {
    if (!currentSession) {
      return normalizeExecutionMode(undefined);
    }
    return normalizeExecutionMode(currentSession.meta.executionMode);
  }, [currentSession]);

  const [planFileContent, setPlanFileContent] = useState(null);

  useEffect(() => {
    const sessionId = currentSession?.meta?.id;
    if (executionMode !== "plan" || !sessionId || !window.cragent?.readPlanContent) {
      setPlanFileContent(null);
      return;
    }
    let cancelled = false;
    void window.cragent
      .readPlanContent(sessionId)
      .then((result) => {
        if (!cancelled) {
          setPlanFileContent(result?.content ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlanFileContent(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    executionMode,
    currentSession?.meta?.id,
    currentSession?.meta?.updatedAt,
    busy,
  ]);

  const planContext = useMemo(() => {
    if (executionMode !== "plan" || !currentSession?.meta?.id) {
      return { active: false };
    }
    return {
      active: true,
      sessionId: currentSession.meta.id,
      displayPath: "plan.md",
      content: planFileContent,
    };
  }, [executionMode, currentSession?.meta?.id, planFileContent]);

  async function handleExitPlanMode() {
    if (!currentSession || busy || executionMode !== "plan") return;
    try {
      const result = await window.cragent.exitPlanMode(currentSession.meta.id);
      if (result?.dismissed) {
        return;
      }
      if (result?.rejected) {
        if (result.session) setCurrentSession(result.session);
        return;
      }
      if (result?.session) setCurrentSession(result.session);
    } catch (err) {
      showSessionError(
        err instanceof Error ? err.message : String(err),
        currentSession.meta.id,
      );
    }
  }

  async function handleExecutionModeChange(nextMode) {
    if (!currentSession || nextMode === executionMode || executionModeSaving) return;
    setExecutionModeSaving(true);
    try {
      const session = await window.cragent.updateExecutionMode?.({
        sessionId: currentSession.meta.id,
        executionMode: nextMode,
      });
      if (session) {
        setCurrentSession(session);
      }
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    } catch (err) {
      showSessionError(
        err instanceof Error ? err.message : String(err),
        currentSession?.meta.id,
      );
    } finally {
      setExecutionModeSaving(false);
    }
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

  async function handleForkMessage(messageId) {
    if (!currentSession || busy || !window.cragent?.forkSession) return;
    try {
      const session = await window.cragent.forkSession({
        sessionId: currentSession.meta.id,
        messageId,
      });
      setCurrentSession(session);
      setFocusedProjectId(session?.meta?.projectId ?? null);
      ensureProjectExpanded(session?.meta?.projectId);
      setSessions((prev) => {
        const has = prev.some((s) => s.id === session.meta.id);
        if (has) return sortSessions(prev);
        return sortSessions([session.meta, ...prev]);
      });
      setPage("chat");
      if (compactLayout) setSidebarOpen(false);
    } catch (err) {
      showSessionError(err instanceof Error ? err.message : String(err), currentSession.meta.id);
    }
  }

  const chatWelcomeLayout = !active && !hasComposerDraft;
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

  function handleTitlebarToggleSettings() {
    if (onSettingsPage) {
      setPage("chat");
      return;
    }
    setPage("settings");
    if (compactLayout) setSidebarOpen(false);
  }

  function handleTitlebarToggleColorScheme() {
    setColorScheme(toggleColorScheme());
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
        colorScheme={colorScheme}
        settingsActive={onSettingsPage}
        onToggleSidebar={handleTitlebarToggleSidebar}
        onFocusSearch={handleTitlebarFocusSearch}
        onNewChat={() => void handleNewChat()}
        onToggleColorScheme={handleTitlebarToggleColorScheme}
        onOpenSettings={handleTitlebarToggleSettings}
      />
      <div
        className={`app${compactLayout ? " app-compact" : ""}${sidebarHidden ? " app-sidebar-hidden" : ""}`}
        style={
          !compactLayout && !sidebarHidden
            ? { "--sidebar-width": `${sidebarWidth}px` }
            : undefined
        }
      >
      <Sidebar
        open={sidebarOpen}
        projects={projects}
        expandedProjectIds={expandedProjectIds}
        sessions={sessions}
        currentSessionId={currentSession?.meta.id}
        busyBySession={busyBySession}
        unreadBySession={unreadBySession}
        settingsActive={onSettingsPage}
        onSelectProject={handleSelectProject}
        onAddProject={async () => {
          const directoryPath = await window.cragent.pickProjectDirectory?.();
          if (directoryPath) {
            await handleAddProjectDirectory(directoryPath);
          }
        }}
        onAddProjectByPath={(directoryPath) => void handleAddProjectDirectory(directoryPath)}
        onNewProjectChat={(projectId) => void handleNewChat(projectId)}
        onRemoveProject={(project) => void handleRemoveProject(project)}
        onSelect={(sessionId) => void handleSwitchSession(sessionId)}
        onDelete={(meta) => void handleDeleteSession(meta)}
        onNewChat={() => void handleNewChat()}
      />
      {!compactLayout && !sidebarHidden ? (
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={sidebarWidth}
          aria-valuemin={SIDEBAR_WIDTH_MIN}
          aria-valuemax={SIDEBAR_WIDTH_MAX}
          aria-label="调整侧栏宽度"
          onPointerDown={handleSidebarResizePointerDown}
        />
      ) : null}
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
            onProbeMcp={
              window.cragent?.probeMcp
                ? (mcp) => window.cragent.probeMcp(mcp)
                : undefined
            }
          />
        ) : (
          <div className="chat-layout">
            <div
              className={`chat-content-column${chatWelcomeLayout ? " chat-content-column--welcome" : ""}`}
            >
            <div className={`chat-history${active ? " chat-history--active" : ""}`}>
              {active && sessionShowsLoadOlder(currentSession) ? (
                <div className="chat-load-older">
                  <button
                    type="button"
                    className="chat-load-older-btn"
                    disabled={loadingOlderMessages}
                    onClick={() => void loadOlderMessages()}
                  >
                    {loadingOlderMessages ? "加载中…" : "加载更早的消息"}
                  </button>
                </div>
              ) : null}
              {currentSession ? (
                <ChatView
                  sessionId={currentSession.meta.id}
                  sessionModelId={currentSession.meta.modelId}
                  messages={currentSession.messages}
                  todoRuns={visibleTodoRuns}
                  busy={busy}
                  verboseThinking={verboseThinking}
                  planContext={planContext}
                  onDelete={handleDeleteMessage}
                  onFork={handleForkMessage}
                  onOpenImage={(image) => setViewerImage(image)}
                  onOpenPlanFile={(sessionId) => window.cragent.openPlanFile?.(sessionId)}
                />
              ) : null}
              {!active ? (
                chatWelcomeLayout ? (
                  <div className="empty-state">
                    <h1>有什么我能帮你的吗？</h1>
                  </div>
                ) : (
                  <div className="empty-state empty-state--overlay" aria-hidden="true">
                    <h1>有什么我能帮你的吗？</h1>
                  </div>
                )
              ) : null}
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
              <div className={`composer-shell${showComposerProjectPicker ? " has-project-picker" : ""}`}>
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
                {showAtMenu ? (
                  <ComposerAtMenu
                    projectName={activeProject?.name || "项目"}
                    projectDirectoryPath={activeProject?.directoryPath || ""}
                    fileIcons={composerFileIcons}
                    browseRelativePath={atBrowseRelativePath}
                    entries={atDirEntries}
                    filter={atPathParts.filter}
                    loading={atDirLoading}
                    error={atDirError}
                    selectedIndex={atMenuIndex}
                    expanded={atMenuExpanded}
                    onExpandedChange={setAtMenuExpanded}
                    onHoverIndex={setAtMenuIndex}
                    onEnterDirectory={enterAtDirectory}
                    onGoParent={goAtParentDirectory}
                    onPickFile={applyAtFilePick}
                  />
                ) : null}
                {atMention && !activeProject?.id && page === "chat" && !showSlashMenu ? (
                  <div className="at-menu-wrap">
                    <div className="at-menu" role="listbox" aria-label="文件与目录">
                      <div className="at-menu-empty">请在项目下创建或选择会话后再使用 @</div>
                    </div>
                  </div>
                ) : null}
                <div
                  className={`composer-box${composerDragOver ? " composer-drag-over" : ""}${messageQueue.length ? " has-queue-toggle" : ""}${showComposerProjectPicker ? " has-project-picker" : ""}`}
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
                    void addFilesFromPicker(e.dataTransfer?.files);
                  }}
                >
                {messageQueue.length > 0 ? (
                  <ComposerQueuePanel
                    queue={messageQueue}
                    open={queuePanelOpen}
                    onToggle={() => setQueuePanelOpen((prev) => !prev)}
                    onRemove={removeQueuedMessage}
                    onReorder={reorderQueuedMessages}
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
                <ComposerTaskStatus todos={currentSession?.meta?.todos} busy={busy} />
                <ComposerHookLog
                  logs={hookLogs}
                  onClear={() => {
                    const sessionId = currentSession?.meta?.id;
                    if (sessionId) {
                      void window.cragent.clearHookLogs?.(sessionId);
                      setHookLogs([]);
                    }
                  }}
                  onCollapse={() => textareaRef.current?.focus()}
                />
                <div
                  className={`composer-input-row${pendingAtMentions.length || pendingFiles.length ? " has-at-mentions" : ""}`}
                  ref={composerInputRowRef}
                >
                  <div className="composer-input-surface">
                    <ComposerSegmentedInput
                    input={input}
                    onInputChange={updateComposerInput}
                    onCaretChange={setComposerCaret}
                    composerCaret={composerCaret}
                    mentions={pendingAtMentions}
                    onRemoveMention={removePendingAtMention}
                    files={pendingFiles}
                    onRemoveFile={removePendingFile}
                    fileIcons={composerFileIcons}
                    projectDirectoryPath={activeProject?.directoryPath || ""}
                    textareaRef={textareaRef}
                    onResize={resizeComposer}
                    placeholder={composerPlaceholder}
                    onPaste={(e) => {
                      const files = Array.from(e.clipboardData?.files || []).filter((file) =>
                        file.type.startsWith("image/"),
                      );
                      if (files.length) {
                        e.preventDefault();
                        void addImagesFromFiles(files);
                        return;
                      }
                      noteComposerTextPaste();
                    }}
                    onKeyDown={(e, segment) => {
                    noteManualComposerTriggerStart(e, segment);
                    if (e.key === "Backspace" && segment?.contentEditable) {
                      const fileId = getComposerFileBeforeSelection(e.currentTarget);
                      if (fileId) {
                        e.preventDefault();
                        removePendingFile(fileId);
                        return;
                      }
                      const mentionId = getComposerMentionBeforeSelection(e.currentTarget);
                      if (mentionId) {
                        e.preventDefault();
                        removePendingAtMention(mentionId);
                        return;
                      }
                    }
                    if (e.key === "Backspace" && pendingAtMentions.length > 0 && !segment?.contentEditable) {
                      const el = e.currentTarget;
                      const start = el?.selectionStart ?? 0;
                      const end = el?.selectionEnd ?? 0;
                      if (start === 0 && end === 0) {
                        e.preventDefault();
                        removeLastPendingAtMention();
                        return;
                      }
                    }
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
                        if (slashMention) {
                          setInput(input.slice(0, slashMention.slashStart) + input.slice(slashMention.slashEnd));
                        }
                        return;
                      }
                      if (e.key === "Tab" || (e.key === "Enter" && !e.altKey && !e.shiftKey)) {
                        e.preventDefault();
                        activateSlashMenuItem(slashNavItems[slashMenuIndex]);
                        return;
                      }
                    }
                    if (showAtMenu && atNavItems.length) {
                      const activeItem = atNavItems[atMenuIndex];
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setAtMenuIndex((prev) => Math.min(prev + 1, atNavItems.length - 1));
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setAtMenuIndex((prev) => Math.max(prev - 1, 0));
                        return;
                      }
                      if (e.key === "ArrowRight" && activeItem?.kind === "entry" && activeItem.entry.kind === "dir") {
                        e.preventDefault();
                        enterAtDirectory(activeItem.entry.relativePath);
                        return;
                      }
                      if (e.key === "ArrowLeft" && atBrowseRelativePath) {
                        e.preventDefault();
                        goAtParentDirectory();
                        return;
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        if (atMention) {
                          setInput(input.slice(0, atMention.mentionStart) + input.slice(atMention.mentionEnd));
                          setComposerCaret(atMention.mentionStart);
                        }
                        return;
                      }
                      if (e.key === "Tab" || (e.key === "Enter" && !e.altKey && !e.shiftKey)) {
                        e.preventDefault();
                        activateAtMenuItem(activeItem);
                        return;
                      }
                    }
                    if (e.key === "Enter" && !e.altKey && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  />
                  </div>
                </div>
                <div className="composer-toolbar-spacer" aria-hidden="true" />
                <div className="composer-toolbar">
                  <div className="composer-quick-menu-wrap" ref={composerQuickMenuRef}>
                    <button
                      type="button"
                      className={`composer-quick-btn${composerQuickMenuOpen ? " is-open" : ""}`}
                      title="更多操作"
                      aria-label="更多操作"
                      onClick={() => setComposerQuickMenuOpen((prev) => !prev)}
                    >
                      +
                    </button>
                    {composerQuickMenuOpen ? (
                      <div className="composer-quick-menu">
                        <button
                          type="button"
                          className="composer-quick-item"
                          onClick={() => {
                            setComposerQuickMenuOpen(false);
                            filePickerRef.current?.click();
                          }}
                        >
                          <span className="composer-quick-item-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
                              <path
                                d="M12 5v14M5 12h14"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                              />
                            </svg>
                          </span>
                          <span className="composer-quick-item-label">添加照片和文件</span>
                        </button>
                        <div className="composer-quick-menu-divider" role="separator" aria-hidden="true" />
                        <button
                          type="button"
                          className={`composer-quick-item${executionMode === "plan" ? " active" : ""}`}
                          role="menuitemradio"
                          aria-checked={executionMode === "plan"}
                          onClick={() => {
                            setComposerQuickMenuOpen(false);
                            void handleExecutionModeChange("plan");
                          }}
                        >
                          <span className="composer-quick-item-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
                              <path
                                d="M4 7h16M4 12h10M4 17h6"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                              />
                            </svg>
                          </span>
                          <span className="composer-quick-item-label">计划模式</span>
                          <span className="composer-quick-item-check">
                            {executionMode === "plan" ? <ComposerMenuCheckIcon /> : null}
                          </span>
                        </button>
                        {executionMode === "plan" ? (
                          <button
                            type="button"
                            className="composer-quick-item composer-quick-item-exit-plan"
                            role="menuitem"
                            disabled={busy || !currentSession}
                            onClick={() => {
                              setComposerQuickMenuOpen(false);
                              void handleExitPlanMode();
                            }}
                          >
                            <span className="composer-quick-item-label">开始执行</span>
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={`composer-quick-item${executionMode === "goal" ? " active" : ""}`}
                          role="menuitemradio"
                          aria-checked={executionMode === "goal"}
                          onClick={() => {
                            setComposerQuickMenuOpen(false);
                            void handleExecutionModeChange("goal");
                          }}
                        >
                          <span className="composer-quick-item-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
                              <path
                                d="M12 3a9 9 0 1 0 9 9"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                              />
                              <path
                                d="M12 8v5l3 2"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                          <span className="composer-quick-item-label">追求目标</span>
                          <span className="composer-quick-item-check">
                            {executionMode === "goal" ? <ComposerMenuCheckIcon /> : null}
                          </span>
                        </button>
                      </div>
                    ) : null}
                    <input
                      ref={filePickerRef}
                      type="file"
                      multiple
                      className="composer-hidden-file-input"
                      onChange={(event) => {
                        void addFilesFromPicker(event.target.files);
                        event.target.value = "";
                      }}
                    />
                  </div>
                  {executionMode === "plan" ? (
                    <span className="composer-plan-mode-indicator">
                      <span className="composer-plan-mode-indicator-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
                          <path
                            d="M4 7h16M4 12h10M4 17h6"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                          />
                        </svg>
                      </span>
                      <span className="composer-plan-mode-indicator-label">计划模式</span>
                    </span>
                  ) : null}
                  <ComposerAuthMenu
                    authMode={currentSession?.meta?.authMode}
                    onChange={(mode) => void handleAuthModeChange(mode)}
                  />
                  <div className="composer-toolbar-right">
                  <ComposerModelMenu
                    config={config}
                    currentModel={currentModel}
                    onChange={(nextModel) => {
                      void handleModelChange(nextModel);
                      requestAnimationFrame(() => {
                        textareaRef.current?.focus();
                      });
                    }}
                  />
                  <div className="composer-context-wrap">
                    <ComposerContextRing
                      buttonRef={contextRingRef}
                      percent={contextUsage?.percent ?? 0}
                      className={
                        contextUsage?.isAtBlockingLimit || contextUsage?.isAboveAutoCompactThreshold
                          ? "composer-context-ring-critical"
                          : contextUsage?.isAboveWarningThreshold
                            ? "composer-context-ring-warning"
                            : ""
                      }
                      onClick={() => {
                        if (contextPopupOpen) {
                          closeContextPopup();
                          return;
                        }
                        setContextPopupOpen(true);
                      }}
                    />
                    <ComposerContextPopup
                      open={contextPopupOpen}
                      usage={contextUsageForPopup}
                      anchorRef={contextRingRef}
                      onClose={closeContextPopup}
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
                    disabled={sendButtonDisabled}
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
                {showComposerProjectPicker ? (
                  <ComposerProjectPicker
                    projects={projects}
                    selectedProjectId={currentSession?.meta?.projectId ?? null}
                    displayLabel={composerProjectLabel}
                    onSelectProject={(projectId) => void handleNewChat(projectId ?? null)}
                    onAddProject={async () => {
                      const directoryPath = await window.cragent.pickProjectDirectory?.();
                      if (!directoryPath) return;
                      const project = await handleAddProjectDirectory(directoryPath);
                      if (project?.id) {
                        await handleNewChat(project.id);
                      }
                    }}
                  />
                ) : null}
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
      {planApprovalRequest ? (
        <PlanApprovalDialog
          displayPath={planApprovalRequest.displayPath}
          content={planApprovalRequest.content}
          onClose={(result) => {
            planApprovalRequest.resolve(result);
            setPlanApprovalRequest(null);
          }}
        />
      ) : null}
      {viewerImage ? (
        <ImageViewer
          src={viewerImage.src || viewerImage.dataUrl}
          onClose={() => setViewerImage(null)}
        />
      ) : null}
    </div>
  );
}
