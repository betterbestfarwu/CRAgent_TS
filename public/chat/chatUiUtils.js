var CRAgentChatUtils = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/shared/chatUiUtils.js
  var chatUiUtils_exports = {};
  __export(chatUiUtils_exports, {
    MAX_TODO_INLINE_DISPLAY: () => MAX_TODO_INLINE_DISPLAY,
    buildThinkingSummary: () => buildThinkingSummary,
    formatThinkingSummaryLine: () => formatThinkingSummaryLine,
    getCurrentInProgressTodo: () => getCurrentInProgressTodo,
    parseToolArguments: () => parseToolArguments,
    sortTodosForDisplay: () => sortTodosForDisplay,
    todoDisplayLabel: () => todoDisplayLabel
  });
  var READ_TOOLS = /* @__PURE__ */ new Set(["read_file", "memory_get"]);
  var LIST_TOOLS = /* @__PURE__ */ new Set(["list_dir"]);
  var SEARCH_TOOLS = /* @__PURE__ */ new Set(["memory_search"]);
  var SHELL_TOOLS = /* @__PURE__ */ new Set(["bash"]);
  var WEB_TOOLS = /* @__PURE__ */ new Set(["web_fetch"]);
  var WRITE_TOOLS = /* @__PURE__ */ new Set(["write_file"]);
  var TODO_STATUS_RANK = {
    in_progress: 0,
    pending: 1,
    completed: 2
  };
  var MAX_TODO_INLINE_DISPLAY = 12;
  function parseToolArguments(raw) {
    if (raw == null || raw === "") {
      return {};
    }
    if (typeof raw === "object") {
      return raw;
    }
    try {
      return JSON.parse(String(raw));
    } catch {
      return {};
    }
  }
  function categorizeToolName(name) {
    if (READ_TOOLS.has(name)) {
      return "read";
    }
    if (LIST_TOOLS.has(name)) {
      return "list";
    }
    if (SEARCH_TOOLS.has(name)) {
      return "search";
    }
    if (SHELL_TOOLS.has(name)) {
      return "shell";
    }
    if (WEB_TOOLS.has(name)) {
      return "web";
    }
    if (WRITE_TOOLS.has(name)) {
      return "write";
    }
    return "other";
  }
  function collectToolCallsFromMessage(msg) {
    if (msg?.role !== "assistant" || !msg.tool_calls?.length) {
      return [];
    }
    return msg.tool_calls.map((call) => ({
      name: call.name || "tool",
      arguments: call.arguments ?? ""
    }));
  }
  function isProcessAssistantWithTools(msg) {
    return msg?.role === "assistant" && Boolean(msg.tool_calls?.length);
  }
  function hasVisibleAssistantContent(msg) {
    return msg?.role === "assistant" && String(msg.content || "").trim().length > 0;
  }
  function pushThinkingItem(items, item) {
    items.push(item);
  }
  function buildThinkingSummary(thinkingMessages) {
    const items = [];
    const ids = [];
    const stats = {
      read: 0,
      readPaths: /* @__PURE__ */ new Set(),
      list: 0,
      search: 0,
      shell: 0,
      web: 0,
      write: 0,
      other: 0,
      assistantText: 0
    };
    for (const msg of thinkingMessages || []) {
      if (msg?.id) {
        ids.push(msg.id);
      }
      if (hasVisibleAssistantContent(msg) && isProcessAssistantWithTools(msg)) {
        stats.assistantText += 1;
        pushThinkingItem(items, {
          kind: "assistant-text",
          content: msg.content || ""
        });
      }
      if (msg?.role === "tool") {
        pushThinkingItem(items, {
          kind: "tool-result",
          name: msg.name || "",
          content: msg.content || ""
        });
        continue;
      }
      for (const call of collectToolCallsFromMessage(msg)) {
        const category = categorizeToolName(call.name);
        if (category === "read") {
          stats.read += 1;
          const args = parseToolArguments(call.arguments);
          const filePath = args.path || args.file_path || args.filePath;
          if (filePath) {
            stats.readPaths.add(String(filePath));
          }
        } else if (category === "list") {
          stats.list += 1;
        } else if (category === "search") {
          stats.search += 1;
        } else if (category === "shell") {
          stats.shell += 1;
        } else if (category === "web") {
          stats.web += 1;
        } else if (category === "write") {
          stats.write += 1;
        } else {
          stats.other += 1;
        }
        pushThinkingItem(items, {
          kind: "tool-call",
          name: call.name,
          arguments: call.arguments
        });
      }
    }
    const stepCount = items.length;
    const summaryLine = formatThinkingSummaryLine(stats, stepCount);
    return { summaryLine, items, ids, stepCount };
  }
  function formatThinkingSummaryLine(stats, stepCount) {
    const parts = [];
    if (stats.read > 0) {
      const unique = stats.readPaths.size;
      if (unique > 0 && unique < stats.read) {
        parts.push(`Read ${stats.read} files (${unique} unique)`);
      } else {
        parts.push(`Read ${stats.read} file${stats.read === 1 ? "" : "s"}`);
      }
    }
    if (stats.list > 0) {
      parts.push(`Listed ${stats.list} ${stats.list === 1 ? "directory" : "directories"}`);
    }
    if (stats.search > 0) {
      parts.push(`${stats.search} search${stats.search === 1 ? "" : "es"}`);
    }
    if (stats.shell > 0) {
      parts.push(`Ran ${stats.shell} command${stats.shell === 1 ? "" : "s"}`);
    }
    if (stats.web > 0) {
      parts.push(`Fetched ${stats.web} URL${stats.web === 1 ? "" : "s"}`);
    }
    if (stats.write > 0) {
      parts.push(`Wrote ${stats.write} file${stats.write === 1 ? "" : "s"}`);
    }
    if (stats.other > 0) {
      parts.push(`${stats.other} other step${stats.other === 1 ? "" : "s"}`);
    }
    if (stats.assistantText > 0) {
      parts.push(`${stats.assistantText} note${stats.assistantText === 1 ? "" : "s"}`);
    }
    if (!parts.length) {
      return `Thinking \xB7 ${stepCount} step${stepCount === 1 ? "" : "s"}`;
    }
    return `Thinking \xB7 ${parts.join(" \xB7 ")} (${stepCount} step${stepCount === 1 ? "" : "s"})`;
  }
  function sortTodosForDisplay(todos) {
    return [...todos || []].filter((item) => item.status !== "cancelled").sort((a, b) => {
      const rankA = TODO_STATUS_RANK[a.status] ?? 9;
      const rankB = TODO_STATUS_RANK[b.status] ?? 9;
      if (rankA !== rankB) {
        return rankA - rankB;
      }
      return String(a.id).localeCompare(String(b.id));
    });
  }
  function todoDisplayLabel(item) {
    if (!item) {
      return "";
    }
    if (item.status === "in_progress") {
      const activeForm = String(item.activeForm || "").trim();
      if (activeForm) {
        return activeForm;
      }
    }
    return String(item.content || "").trim();
  }
  function getCurrentInProgressTodo(todos) {
    return sortTodosForDisplay(todos).find((item) => item.status === "in_progress") || null;
  }
  return __toCommonJS(chatUiUtils_exports);
})();
