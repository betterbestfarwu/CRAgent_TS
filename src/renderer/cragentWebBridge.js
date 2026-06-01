import {
  isDefaultSessionTitle,
  pickPlaceholderSession,
  titleFromFirstUserMessage,
} from "@shared/sessionTitle";
import { DEFAULT_CONTEXT_CONFIG } from "@shared/contextConfig";
import { formatHelpText, matchChatCommand } from "@shared/chatCommands";
import {
  CONTEXT_DIVIDER_LABEL,
  CONTEXT_DIVIDER_ROLE,
} from "@shared/chatMessages";

const CONFIG_KEY = "cragent:web:config";
const SESSIONS_KEY = "cragent:web:sessions";
const CURRENT_KEY = "cragent:web:currentSessionId";

function nowIso() {
  return new Date().toISOString();
}

function randomId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeDefaultConfig() {
  const models = ["gpt-4o-mini", "gpt-5", "claude-opus-4-5", "gemini-2.5-pro"].map((id) => ({
    id,
    name: id,
    description: "",
    reasoning: false,
    input: ["text"],
    cost: {},
    contextWindow: 128000,
    maxTokens: 8192,
    state: true,
    stream: false,
  }));
  return {
    content_limit: 5000,
    context: { ...DEFAULT_CONTEXT_CONFIG },
    models: {
      openai: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
        api: "chat/completions",
        state: true,
        models,
      },
    },
    agents: {
      default: {
        model: { primary: "openai/gpt-4o-mini", fallbacks: [] },
        workspace: "~/.CRAgent",
        execution_mode: "goal",
      },
      list: [
        {
          id: "main",
          name: "main",
          is_default: true,
          max_tool_rounds: 12,
          tools: {
            enable_tools: true,
            enable_file_tools: true,
            enable_skills: true,
            allow_sub_agents: false,
          },
        },
      ],
    },
  };
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadConfig() {
  const parsed = parseJson(localStorage.getItem(CONFIG_KEY) || "");
  if (parsed && typeof parsed === "object") return parsed;
  const fallback = makeDefaultConfig();
  localStorage.setItem(CONFIG_KEY, JSON.stringify(fallback));
  return fallback;
}

function saveConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

function loadSessions() {
  const parsed = parseJson(localStorage.getItem(SESSIONS_KEY) || "");
  if (Array.isArray(parsed)) return parsed;
  return [];
}

function saveSessions(sessions) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

function defaultModelRef(config) {
  const primary = config?.agents?.default?.model?.primary || "openai/gpt-4o-mini";
  const [providerKey = "openai", modelId = "gpt-4o-mini"] = primary.split("/");
  return { providerKey, modelId };
}

function makeSession(config, projectId = null) {
  const timestamp = nowIso();
  const { providerKey, modelId } = defaultModelRef(config);
  return {
    meta: {
      id: randomId(),
      title: "新会话",
      providerKey,
      modelId,
      projectId,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    messages: [],
  };
}

function sortMetasByUpdatedAt(metas) {
  return [...metas].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function openNewSession(state) {
  const projectId =
    typeof state.newSessionProjectId === "string" && state.newSessionProjectId.trim()
      ? state.newSessionProjectId.trim()
      : null;
  const existing = pickPlaceholderSession(
    state.sessions.filter((session) => {
      const id = typeof session.meta?.projectId === "string" ? session.meta.projectId.trim() : null;
      return id === projectId;
    }),
  );
  if (existing) {
    return {
      ...state,
      currentSessionId: existing.meta.id,
    };
  }
  const created = makeSession(state.config, projectId);
  return {
    ...state,
    sessions: [created, ...state.sessions],
    currentSessionId: created.meta.id,
  };
}

function ensureState() {
  const config = loadConfig();
  let sessions = loadSessions();
  if (sessions.length === 0) {
    sessions = [makeSession(config)];
    saveSessions(sessions);
  }
  let currentSessionId = localStorage.getItem(CURRENT_KEY);
  if (!currentSessionId || !sessions.some((session) => session.meta.id === currentSessionId)) {
    currentSessionId = sessions[0].meta.id;
    localStorage.setItem(CURRENT_KEY, currentSessionId);
  }
  return { config, sessions, currentSessionId };
}

function updateState(mutator) {
  const state = ensureState();
  const next = mutator({
    config: clone(state.config),
    sessions: clone(state.sessions),
    currentSessionId: state.currentSessionId,
  });
  if (next.config) saveConfig(next.config);
  if (next.sessions) saveSessions(next.sessions);
  if (next.currentSessionId) localStorage.setItem(CURRENT_KEY, next.currentSessionId);
  return {
    config: next.config || state.config,
    sessions: next.sessions || state.sessions,
    currentSessionId: next.currentSessionId || state.currentSessionId,
  };
}

export function installWebBridge() {
  if (window.cragent) return window.cragent;

  const listeners = {
    messageAppended: new Set(),
    sessionChanged: new Set(),
    busyChanged: new Set(),
    error: new Set(),
    openSettings: new Set(),
  };

  const subscribe = (set, callback) => {
    set.add(callback);
    return () => set.delete(callback);
  };

  const emit = (set, payload) => {
    set.forEach((callback) => {
      try {
        callback(payload);
      } catch {
        // Swallow callback errors to avoid breaking other listeners.
      }
    });
  };

  const api = {
    async getSnapshot() {
      const { config, sessions, currentSessionId } = ensureState();
      return {
        config,
        projects: [],
        sessions: sortMetasByUpdatedAt(sessions.map((session) => session.meta)),
        currentSessionId,
      };
    },

    async getSession(sessionId) {
      const { sessions } = ensureState();
      const session = sessions.find((item) => item.meta.id === sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);
      return session;
    },

    async listSkills() {
      return [];
    },

    async listProjects() {
      return [];
    },

    async addProject() {
      throw new Error("Web 演示模式暂不支持添加项目目录。");
    },

    async pickProjectDirectory() {
      return null;
    },

    async listProjectDirectory() {
      return { relativePath: "", entries: [] };
    },

    async newSession(args = {}) {
      const next = updateState((state) =>
        openNewSession({
          ...state,
          newSessionProjectId: args?.projectId ?? null,
        }),
      );
      const session = next.sessions.find((item) => item.meta.id === next.currentSessionId);
      emit(listeners.sessionChanged, session);
      return session;
    },

    async deleteSession(sessionId) {
      const next = updateState((state) => {
        let sessions = state.sessions.filter((item) => item.meta.id !== sessionId);
        if (sessions.length === 0) {
          sessions = [makeSession(state.config)];
        }
        const currentSessionId = sessions.some((item) => item.meta.id === state.currentSessionId)
          ? state.currentSessionId
          : sessions[0].meta.id;
        return { ...state, sessions, currentSessionId };
      });
      const session = next.sessions.find((item) => item.meta.id === next.currentSessionId);
      emit(listeners.sessionChanged, session);
      return session;
    },

    async deleteMessages({ sessionId, messageIds }) {
      const idSet = new Set(messageIds);
      const next = updateState((state) => {
        const sessions = state.sessions.map((item) => {
          if (item.meta.id !== sessionId) return item;
          return {
            ...item,
            meta: { ...item.meta, updatedAt: nowIso() },
            messages: item.messages.filter((message) => !idSet.has(message.id)),
          };
        });
        return { ...state, sessions };
      });
      const session = next.sessions.find((item) => item.meta.id === sessionId);
      emit(listeners.sessionChanged, session);
      return session;
    },

    async sendChat({ sessionId, userInput, images = [] }) {
      const trimmed = String(userInput || "").trim();
      const storedImages = Array.isArray(images)
        ? images
            .filter((image) => image?.dataUrl && image?.mimeType)
            .map((image) => ({
              mimeType: image.mimeType,
              dataUrl: image.dataUrl,
            }))
        : [];
      if (!trimmed && !storedImages.length) {
        return;
      }

      const commandId = matchChatCommand(trimmed);
      if (commandId === "new_session") {
        const next = updateState((state) => openNewSession(state));
        const session = next.sessions.find((item) => item.meta.id === next.currentSessionId);
        emit(listeners.sessionChanged, session);
        return;
      }
      if (commandId === "reset_context") {
        const dividerMessage = {
          id: randomId(),
          role: CONTEXT_DIVIDER_ROLE,
          content: CONTEXT_DIVIDER_LABEL,
          createdAt: nowIso(),
        };
        updateState((state) => {
          const sessions = state.sessions.map((item) => {
            if (item.meta.id !== sessionId) return item;
            return {
              ...item,
              meta: { ...item.meta, updatedAt: dividerMessage.createdAt },
              messages: [...item.messages, dividerMessage],
            };
          });
          return { ...state, sessions };
        });
        emit(listeners.messageAppended, { sessionId, message: dividerMessage });
        const { sessions } = ensureState();
        const session = sessions.find((item) => item.meta.id === sessionId);
        emit(listeners.sessionChanged, session);
        return;
      }
      if (commandId === "help") {
        const runId = randomId();
        const userMessage = {
          id: randomId(),
          role: "user",
          content: trimmed,
          createdAt: nowIso(),
          runId,
        };
        const sessionForHelp = ensureState().sessions.find((item) => item.meta.id === sessionId);
        const assistantMessage = {
          id: randomId(),
          role: "assistant",
          content: formatHelpText(),
          createdAt: nowIso(),
          runId,
          modelId: sessionForHelp?.meta.modelId,
        };
        updateState((state) => {
          const sessions = state.sessions.map((item) => {
            if (item.meta.id !== sessionId) return item;
            return {
              ...item,
              meta: { ...item.meta, updatedAt: assistantMessage.createdAt },
              messages: [...item.messages, userMessage, assistantMessage],
            };
          });
          return { ...state, sessions };
        });
        emit(listeners.messageAppended, { sessionId, message: userMessage });
        emit(listeners.messageAppended, { sessionId, message: assistantMessage });
        const { sessions } = ensureState();
        const session = sessions.find((item) => item.meta.id === sessionId);
        emit(listeners.sessionChanged, session);
        return;
      }
      if (commandId === "compact_context") {
        const sessionForNotice = ensureState().sessions.find((item) => item.meta.id === sessionId);
        const notice = {
          id: randomId(),
          role: "assistant",
          content: "Web 演示模式暂不支持 /compact。",
          createdAt: nowIso(),
          modelId: sessionForNotice?.meta.modelId,
        };
        updateState((state) => {
          const sessions = state.sessions.map((item) => {
            if (item.meta.id !== sessionId) return item;
            return {
              ...item,
              meta: { ...item.meta, updatedAt: notice.createdAt },
              messages: [...item.messages, notice],
            };
          });
          return { ...state, sessions };
        });
        emit(listeners.messageAppended, { sessionId, message: notice });
        return;
      }

      const runId = randomId();
      const userMessage = {
        id: randomId(),
        role: "user",
        content: trimmed,
        createdAt: nowIso(),
        runId,
        ...(storedImages.length ? { images: storedImages } : {}),
      };

      updateState((state) => {
        const sessions = state.sessions.map((item) => {
          if (item.meta.id !== sessionId) return item;
          const title = isDefaultSessionTitle(item.meta.title)
            ? titleFromFirstUserMessage(trimmed) || item.meta.title
            : item.meta.title;
          return {
            ...item,
            meta: { ...item.meta, title, updatedAt: userMessage.createdAt },
            messages: [...item.messages, userMessage],
          };
        });
        return { ...state, sessions, currentSessionId: sessionId };
      });

      emit(listeners.messageAppended, { sessionId, message: userMessage });
      emit(listeners.busyChanged, { sessionId, busy: true });

      setTimeout(() => {
        const sessionForReply = ensureState().sessions.find((item) => item.meta.id === sessionId);
        const assistantMessage = {
          id: randomId(),
          role: "assistant",
          content:
            "这是 iPad 容器内的本地演示回复。\n\n你刚刚发送的是：\n\n" + trimmed,
          createdAt: nowIso(),
          runId,
          modelId: sessionForReply?.meta.modelId,
        };

        updateState((state) => {
          const sessions = state.sessions.map((item) => {
            if (item.meta.id !== sessionId) return item;
            return {
              ...item,
              meta: { ...item.meta, updatedAt: assistantMessage.createdAt },
              messages: [...item.messages, assistantMessage],
            };
          });
          return { ...state, sessions };
        });

        emit(listeners.messageAppended, { sessionId, message: assistantMessage });
        emit(listeners.busyChanged, { sessionId, busy: false });
      }, 450);
    },

    async updateModel({ sessionId, providerKey, modelId }) {
      const next = updateState((state) => {
        const sessions = state.sessions.map((item) =>
          item.meta.id === sessionId
            ? { ...item, meta: { ...item.meta, providerKey, modelId, updatedAt: nowIso() } }
            : item,
        );
        return { ...state, sessions };
      });
      const session = next.sessions.find((item) => item.meta.id === sessionId);
      emit(listeners.sessionChanged, session);
    },

    async updateConfig(nextConfig) {
      updateState((state) => ({ ...state, config: nextConfig }));
      return nextConfig;
    },

    async probeMcp() {
      return {
        ok: false,
        error: "MCP 连接测试仅在桌面版可用",
      };
    },

    async getMcpStatus() {
      return { toolCount: 0, errors: {} };
    },

    async syncProviderModels({ providerKey, connection }) {
      const { config } = ensureState();
      if (!providerKey || !config.models?.[providerKey]) {
        return { ok: false, error: "未找到 provider" };
      }
      const existing = config.models[providerKey];
      const provider = connection
        ? {
            ...existing,
            baseUrl: connection.baseUrl ?? existing.baseUrl,
            apiKey: connection.apiKey ?? existing.apiKey,
            api: connection.api ?? existing.api,
          }
        : existing;
      const nextConfig = {
        ...config,
        models: {
          ...config.models,
          [providerKey]: provider,
        },
      };
      updateState((state) => ({ ...state, config: nextConfig }));
      return { ok: true, providerKey, count: provider.models.length, config: nextConfig };
    },

    onMessageAppended(callback) {
      return subscribe(listeners.messageAppended, callback);
    },
    onSessionChanged(callback) {
      return subscribe(listeners.sessionChanged, callback);
    },
    onBusyChanged(callback) {
      return subscribe(listeners.busyChanged, callback);
    },
    onError(callback) {
      return subscribe(listeners.error, callback);
    },
    onOpenSettings(callback) {
      return subscribe(listeners.openSettings, callback);
    },
  };

  window.cragent = api;
  return api;
}
