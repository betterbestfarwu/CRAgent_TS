import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChatView } from "./ChatView.jsx";
import { ComposerAuthMenu, ComposerMenuCheckIcon } from "./ComposerAuthMenu.jsx";
import { ComposerContextRing } from "./ComposerContextRing.jsx";
import { ComposerContextPopup } from "./ComposerContextPopup.jsx";
import { ComposerQueuePanel } from "./ComposerQueuePanel.jsx";
import { ComposerTaskStatus } from "./ComposerTaskStatus.jsx";
import {
  buildSlashMenuNavItems,
  ComposerSlashMenu,
  filterSlashCommands,
  filterSlashSkills,
} from "./ComposerSlashMenu.jsx";
import { ComposerAtMenu } from "./ComposerAtMenu.jsx";
import { ComposerAtChips } from "./ComposerAtChips.jsx";
import {
  atMentionFileName,
  buildAtNavItems,
  buildInputWithAtMentions,
  filterDirectoryEntries,
  parentRelativePath,
  parseActiveAtMention,
  splitAtQueryPath,
} from "@shared/atMention.js";
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
import {
    estimateMcpToolDefinitionTokens,
    getEnabledMcpServers,
} from "@shared/mcpConfig.js";
import { formatModelRef, modelRefLabel } from "@shared/modelRef.js";

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
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [currentSession, setCurrentSession] = useState(null);
  const [config, setConfig] = useState(null);
  const [skills, setSkills] = useState([]);
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState([]);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [pendingAtMentions, setPendingAtMentions] = useState([]);
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
  const [runtimeContextState, setRuntimeContextState] = useState(null);
  const [executionModeSaving, setExecutionModeSaving] = useState(false);
  const [composerQuickMenuOpen, setComposerQuickMenuOpen] = useState(false);
  const contextRingRef = useRef(null);
  const composerQuickMenuRef = useRef(null);
  const filePickerRef = useRef(null);
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
      setProjects(Array.isArray(snapshot.projects) ? snapshot.projects : []);
      const sorted = sortSessions(snapshot.sessions);
      setSessions(sorted);
      const sessionId = snapshot.currentSessionId || sorted[0]?.id;
      if (!sessionId) {
        showSessionError("没有可用会话。");
        return;
      }
      const session = await window.cragent.getSession(sessionId);
      setCurrentSession(session);
      setSelectedProjectId(session?.meta?.projectId || null);
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
      setSelectedProjectId(session?.meta?.projectId || null);
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

    const offContextWarning = window.cragent.onContextWarningChanged?.((payload) => {
      if (sessionIdRef.current === payload.sessionId) {
        setRuntimeContextState(payload);
      }
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
      offContextWarning?.();
    };
  }, []);

  useEffect(() => {
    if (!busy) {
      void refreshSkills();
    }
  }, [busy, refreshSkills]);

  const currentModel = useMemo(() => {
    if (!config || !currentSession) return "";
    return formatModelRef(currentSession.meta.providerKey, currentSession.meta.modelId);
  }, [config, currentSession]);

  const [modelDisplay, setModelDisplay] = useState("");

  useEffect(() => {
    setModelDisplay(currentModel);
  }, [currentModel]);

  useEffect(() => {
    setRuntimeContextState(null);
  }, [currentSession?.meta?.id]);

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
    const mcpServers = getEnabledMcpServers(config);
    const mcpTokens =
      agentTools.enable_mcp !== false
        ? estimateMcpToolDefinitionTokens(mcpServers.length > 0 ? mcpServers.length * 2 : 0)
        : 0;
    const estimated = estimateSessionContextBreakdown(currentSession, model, {
      compactBufferTokens: compactBuffer,
      agentTools,
      skillsCatalogText,
      mcpTokens,
    });
    if (
      !runtimeContextState ||
      runtimeContextState.sessionId !== currentSession.meta.id
    ) {
      return estimated;
    }
    return {
      ...estimated,
      percent: runtimeContextState.percent ?? estimated.percent,
      isAboveWarningThreshold:
        runtimeContextState.isAboveWarningThreshold ?? estimated.isAboveWarningThreshold,
      isAboveAutoCompactThreshold:
        runtimeContextState.isAboveAutoCompactThreshold ??
        estimated.isAboveAutoCompactThreshold,
      isAtBlockingLimit: runtimeContextState.isAtBlockingLimit ?? estimated.isAtBlockingLimit,
    };
  }, [currentSession, config, skills, runtimeContextState]);

  const slashQuery = useMemo(() => {
    const match = input.match(/^\/([^\s]*)$/);
    return match ? match[1].toLowerCase() : null;
  }, [input]);

  const atMention = useMemo(() => parseActiveAtMention(input), [input]);

  const activeProject = useMemo(() => {
    const projectId = currentSession?.meta?.projectId;
    if (!projectId) return null;
    return projects.find((project) => project.id === projectId) || null;
  }, [currentSession?.meta?.projectId, projects]);

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

  useEffect(() => {
    if (!atMention) {
      setAtBrowseRelativePath("");
      setAtDirEntries([]);
      setAtDirError("");
      return;
    }
    setAtBrowseRelativePath(atPathParts.relativePath);
  }, [atMention, atPathParts.relativePath]);

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

  const showSlashMenu = page === "chat" && slashQuery !== null;
  const showAtMenu =
    page === "chat" && atMention !== null && Boolean(activeProject?.id) && !showSlashMenu;
  const sendButtonDisabled = !busy && !canSend;

  function replaceActiveAtMention(nextMentionBody) {
    if (!atMention) return;
    const prefix = input.slice(0, atMention.mentionStart);
    const suffix = input.slice(atMention.mentionEnd);
    const body = String(nextMentionBody ?? "");
    setInput(`${prefix}@${body}${suffix}`);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      resizeComposer();
    });
  }

  function applyAtFilePick(relativePath) {
    const cleanPath = String(relativePath ?? "").trim();
    if (!cleanPath) return;
    const name = atMentionFileName(cleanPath);
    setPendingAtMentions((prev) => {
      if (prev.some((mention) => mention.relativePath === cleanPath)) {
        return prev;
      }
      return [...prev, { id: crypto.randomUUID(), name, relativePath: cleanPath }];
    });
    if (atMention) {
      const prefix = input.slice(0, atMention.mentionStart);
      const suffix = input.slice(atMention.mentionEnd);
      setInput(`${prefix}${suffix}`);
    }
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      resizeComposer();
    });
  }

  function enterAtDirectory(relativePath) {
    const next = relativePath ? `${relativePath}/` : "";
    replaceActiveAtMention(next);
    setAtBrowseRelativePath(relativePath);
  }

  function goAtParentDirectory() {
    const parent = parentRelativePath(atBrowseRelativePath);
    const next = parent ? `${parent}/` : "";
    replaceActiveAtMention(next);
    setAtBrowseRelativePath(parent);
  }

  function activateAtMenuItem(item) {
    if (!item) return;
    if (item.kind === "parent") {
      goAtParentDirectory();
      return;
    }
    const { entry } = item;
    if (entry.kind === "dir") {
      enterAtDirectory(entry.relativePath);
      return;
    }
    applyAtFilePick(entry.relativePath);
  }

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
    setPendingFiles((prev) => prev.filter((file) => file.id !== fileId));
  }

  async function handleAddProjectDirectory(directoryPath) {
    const cleanPath = String(directoryPath || "").trim();
    if (!cleanPath) return;
    try {
      const project = await window.cragent.addProject(cleanPath);
      setProjects((prev) => {
        if (prev.some((item) => item.id === project.id)) {
          return prev;
        }
        return [...prev, project].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
      });
      setSelectedProjectId(project.id);
    } catch (err) {
      showSessionError(err instanceof Error ? err.message : String(err), currentSession?.meta?.id);
    }
  }

  function removePendingAtMention(mentionId) {
    setPendingAtMentions((prev) => prev.filter((mention) => mention.id !== mentionId));
  }

  function removeLastPendingAtMention() {
    setPendingAtMentions((prev) => (prev.length ? prev.slice(0, -1) : prev));
  }

  const composerPlaceholder =
    pendingAtMentions.length || pendingImages.length || pendingFiles.length ? "" : "发消息...";

  function buildSendPayload(trimmed) {
    const atMentions = pendingAtMentions.map(({ name, relativePath }) => ({ name, relativePath }));
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
      setPendingImages([]);
      setPendingFiles([]);
      setPendingAtMentions([]);
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
    setPendingImages([]);
    setPendingFiles([]);
    setPendingAtMentions([]);
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

  async function handleNewChat(projectId = selectedProjectId) {
    if (newChatInFlightRef.current) return;
    newChatInFlightRef.current = true;
    try {
      clearSessionError();
      const next = await window.cragent.newSession({ projectId: projectId || null });
      setCurrentSession(next);
      setSelectedProjectId(next?.meta?.projectId || null);
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

  function handleSelectProject(projectId) {
    if (projectId === null) {
      setSelectedProjectId(null);
      return;
    }
    setSelectedProjectId((prev) => (prev === projectId ? null : projectId));
  }

  async function handleSwitchSession(sessionId) {
    clearSessionError();
    const session = await window.cragent.getSession(sessionId);
    setCurrentSession(session);
    setSelectedProjectId(session?.meta?.projectId || null);
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
      setSelectedProjectId(session?.meta?.projectId || null);
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

  const executionMode =
    config?.agents?.default?.execution_mode === "plan" ? "plan" : "goal";

  async function handleExecutionModeChange(nextMode) {
    if (!config || nextMode === executionMode || executionModeSaving) return;
    const nextConfig = {
      ...config,
      agents: {
        ...config.agents,
        default: {
          ...(config.agents?.default || {}),
          execution_mode: nextMode,
        },
      },
    };
    setExecutionModeSaving(true);
    try {
      const updated = await window.cragent.updateConfig(nextConfig);
      setConfig(updated);
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

  function handleTitlebarToggleSettings() {
    if (onSettingsPage) {
      setPage("chat");
      return;
    }
    setPage("settings");
    if (compactLayout) setSidebarOpen(false);
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
        onOpenSettings={handleTitlebarToggleSettings}
      />
      <div
        className={`app${compactLayout ? " app-compact" : ""}${sidebarHidden ? " app-sidebar-hidden" : ""}`}
      >
      <Sidebar
        open={sidebarOpen}
        projects={projects}
        selectedProjectId={selectedProjectId}
        sessions={sessions}
        currentSessionId={currentSession?.meta.id}
        busyBySession={busyBySession}
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
            onProbeMcp={
              window.cragent?.probeMcp
                ? (mcp) => window.cragent.probeMcp(mcp)
                : undefined
            }
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
                {showAtMenu ? (
                  <ComposerAtMenu
                    projectName={activeProject?.name || "项目"}
                    projectDirectoryPath={activeProject?.directoryPath || ""}
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
                {pendingImages.length || pendingFiles.length ? (
                  <div className="composer-attachments" aria-label="待发送附件">
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
                    {pendingFiles.map((file) => (
                      <div key={file.id} className="composer-file-attachment">
                        <span className="composer-file-name" title={file.path || file.name}>
                          {file.name}
                        </span>
                        <button
                          type="button"
                          className="composer-file-remove"
                          title="移除文件"
                          aria-label="移除文件"
                          onClick={() => removePendingFile(file.id)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <ComposerTaskStatus todos={currentSession?.meta?.todos} busy={busy} />
                <div className="composer-input-row">
                  <ComposerAtChips
                    mentions={pendingAtMentions}
                    onRemove={removePendingAtMention}
                  />
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
                  placeholder={composerPlaceholder}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && pendingAtMentions.length > 0) {
                      const el = textareaRef.current;
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
                        setInput("");
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
                  <ComposerAuthMenu
                    authMode={currentSession?.meta?.authMode}
                    onChange={(mode) => void handleAuthModeChange(mode)}
                  />
                  <div className="composer-toolbar-right">
                  <label className="composer-model-wrap">
                    <span className="composer-model-content">
                      <span className="composer-model-sizer" aria-hidden="true">
                        {modelRefLabel(modelDisplay)}
                      </span>
                      <span className="composer-model-label">{modelRefLabel(modelDisplay)}</span>
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
                              currentModel === formatModelRef(providerKey, model.id),
                          )
                          .map((model) => (
                            <option
                              key={formatModelRef(providerKey, model.id)}
                              value={formatModelRef(providerKey, model.id)}
                            >
                              {model.id}
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
                        contextUsage?.isAtBlockingLimit || contextUsage?.isAboveAutoCompactThreshold
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
