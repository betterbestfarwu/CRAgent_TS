/** Natural-language phrases that reset LLM context (same as /clear and /reset). */
export const RESET_CONTEXT_TRIGGERS = [
  "重置上下文",
  "清空上下文，开启新对话",
  "重置会话状态",
  "以上内容作废",
  "忽略之前的所有对话，重新开始",
  "忘记上面的内容，我们重新聊",
];

export const CHAT_COMMANDS = [
  {
    id: "new_session",
    name: "new",
    description: "新建会话（与菜单 New Chat 相同）",
  },
  {
    id: "reset_context",
    name: "clear",
    aliases: ["reset"],
    triggers: RESET_CONTEXT_TRIGGERS,
    description: "重置模型上下文（保留聊天记录；同 /reset）",
  },
  {
    id: "compact_context",
    name: "compact",
    description: "将较早上下文压缩为结构化摘要（保留最近消息；接近窗口上限时也会自动压缩）",
  },
  {
    id: "help",
    name: "help",
    description: "显示可用 slash 指令与工作区说明",
  },
  {
    id: "computer_use",
    name: "computer",
    description: "使用 computer_action / computer_* 工具控制桌面（需 vision 模型；设置中启用 Computer use）",
    slashOnly: true,
  },
];

export function getCommandSlashNames(command) {
  return [command.name, ...(command.aliases || [])];
}

/**
 * Active `/` command at end of composer text.
 * @param {string} text
 * @returns {{ query: string, slashStart: number, slashEnd: number } | null}
 */
export function parseActiveSlashCommand(text) {
  const value = String(text ?? "");
  const slashIndex = value.lastIndexOf("/");
  if (slashIndex === -1) return null;

  const query = value.slice(slashIndex + 1);
  if (/\s/.test(query)) return null;

  return {
    query,
    slashStart: slashIndex,
    slashEnd: value.length,
  };
}

/**
 * @param {{ key?: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean } | null | undefined} event
 * @returns {boolean}
 */
export function isSlashKey(event) {
  if (!event || event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key === "/";
}

/**
 * @param {{ slashStart: number } | null | undefined} slashMention
 * @param {number | null | undefined} manualStart
 * @returns {boolean}
 */
export function isActiveManualSlashCommand(slashMention, manualStart) {
  if (!slashMention || manualStart == null) return false;
  return manualStart === slashMention.slashStart;
}

export function matchChatCommand(input) {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  for (const command of CHAT_COMMANDS) {
    if (command.slashOnly) {
      continue;
    }
    for (const slashName of getCommandSlashNames(command)) {
      if (trimmed.toLowerCase() === `/${slashName}`.toLowerCase()) {
        return command.id;
      }
    }
    for (const trigger of command.triggers || []) {
      if (trimmed === trigger) {
        return command.id;
      }
    }
  }
  return null;
}

function normalizeSlashCommandSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

export function filterSlashCommands(query) {
  const normalized = String(query || "").toLowerCase();
  const compactNormalized = normalizeSlashCommandSearchText(query);
  return CHAT_COMMANDS.filter((command) => {
    if (!normalized) {
      return true;
    }
    const names = getCommandSlashNames(command);
    if (names.some((name) => name.toLowerCase().includes(normalized))) {
      return true;
    }
    if (
      compactNormalized &&
      names.some((name) =>
        normalizeSlashCommandSearchText(name).includes(compactNormalized),
      )
    ) {
      return true;
    }
    return String(command.description || "")
      .toLowerCase()
      .includes(normalized);
  });
}

export function formatHelpText() {
  const commandLines = CHAT_COMMANDS.flatMap((command) => {
    const names = getCommandSlashNames(command)
      .map((name) => `/${name}`)
      .join(" ");
    return [`${names} — ${command.description}`];
  });

  return [
    ...commandLines,
    "",
    "也可直接发送以下短语重置上下文:",
    ...RESET_CONTEXT_TRIGGERS.map((phrase) => `- ${phrase}`),
    "",
    "Workspace memory (`~/.CRAgent`):",
    "- SOUL.md — identity & tone",
    "- AGENTS.md — operating rules",
    "- USER.md — about you",
    "- MEMORY.md — long-term curated memory",
    "- memory/YYYY-MM-DD.md — daily notes (today + yesterday loaded each turn)",
    "",
    "Skills: ~/.CRAgent/skills/ — use load_skill, download_skill, delete_skill",
    "",
    "Computer use: /computer [任务描述] — computer_action（screenshot/click/drag/type/key/scroll/wait）或底层 computer_* 工具",
  ].join("\n");
}

/** Match `/computer` (or legacy `/computer use`) with optional task text (case-insensitive). */
export function parseComputerUseInvocation(input) {
  const match = String(input || "")
    .trim()
    .match(/^\/computer(?:[\s_-]*use)?(?:\s+([\s\S]*))?$/i);
  if (!match) {
    return null;
  }
  return { rest: (match[1] || "").trim() };
}

export function buildComputerUsePrompt(rest, { enabled = false } = {}) {
  if (!enabled) {
    return [
      "Computer use 未在设置中启用。",
      "请在 设置 → Agent → Tools 中打开 Enable computer use，并使用支持 vision 的模型后重试。",
    ].join("\n");
  }
  const workflow = [
    "建议流程：使用 computer_action 先截图，观察截图内容，再执行一个明确动作，最后按需再次截图验证结果。",
    "可用动作：screenshot, move, click, double_click, drag, type, key, scroll, wait。",
    "多显示器或坐标不确定时，可先调用 computer_displays；底层 computer_screenshot / computer_click 等工具仍可使用。",
  ].join("\n");
  if (rest) {
    return `请使用 computer_* 桌面控制工具完成任务：${rest}\n\n${workflow}`;
  }
  return [
    "请使用 computer_action / computer_* 桌面控制工具查看并操作当前桌面。",
    workflow,
    "按“截图 → 观察 → 执行 → 验证”的节奏推进，不要在未观察截图前盲目点击或输入。",
  ].join("\n");
}
