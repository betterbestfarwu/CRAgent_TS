/** Hooks config file name at workspace or config.json directory. */
export const HOOKS_CONFIG_FILENAME = "hooks.json";

/** Hook events (Claude Code PascalCase). Cursor camelCase aliases map here. */
export const HOOK_EVENTS = [
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "UserPromptSubmit",
    "SessionStart",
    "SessionEnd",
    "Stop",
    "StopFailure",
    "SubagentStart",
    "SubagentStop",
    "BeforeShellExecution",
    "AfterShellExecution",
    "PreCompact",
    "PostCompact",
];

const CURSOR_EVENT_ALIASES = {
    preToolUse: "PreToolUse",
    postToolUse: "PostToolUse",
    postToolUseFailure: "PostToolUseFailure",
    beforeSubmitPrompt: "UserPromptSubmit",
    userPromptSubmit: "UserPromptSubmit",
    sessionStart: "SessionStart",
    sessionEnd: "SessionEnd",
    stop: "Stop",
    stopFailure: "StopFailure",
    subagentStart: "SubagentStart",
    subagentStop: "SubagentStop",
    beforeShellExecution: "BeforeShellExecution",
    afterShellExecution: "AfterShellExecution",
    preCompact: "PreCompact",
    postCompact: "PostCompact",
};

export function normalizeHookEvent(raw) {
    const key = String(raw || "").trim();
    if (!key) {
        return null;
    }
    if (HOOK_EVENTS.includes(key)) {
        return key;
    }
    if (CURSOR_EVENT_ALIASES[key]) {
        return CURSOR_EVENT_ALIASES[key];
    }
    const pascal =
        key.charAt(0).toUpperCase() +
        key
            .slice(1)
            .replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    return HOOK_EVENTS.includes(pascal) ? pascal : null;
}

export function normalizeHookDefinition(raw) {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const type = raw.type === "prompt" ? "prompt" : "command";
    if (type === "prompt") {
        const prompt = String(raw.prompt || "").trim();
        if (!prompt) {
            return null;
        }
        return {
            type: "prompt",
            prompt,
            matcher: raw.matcher != null ? String(raw.matcher) : undefined,
            timeout: positiveNumber(raw.timeout),
            failClosed: Boolean(raw.failClosed),
        };
    }
    const command = String(raw.command || "").trim();
    if (!command) {
        return null;
    }
    return {
        type: "command",
        command,
        matcher: raw.matcher != null ? String(raw.matcher) : undefined,
        timeout: positiveNumber(raw.timeout),
        failClosed: Boolean(raw.failClosed),
    };
}

function positiveNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Parse hooks.json (version 1). Returns { hooks: Record<HookEvent, HookDef[]> }.
 */
export function parseHooksFileJson(raw) {
    const hooks = {};
    if (!raw || typeof raw !== "object") {
        return { hooks };
    }
    const bucket = raw.hooks && typeof raw.hooks === "object" ? raw.hooks : raw;
    for (const [eventKey, entries] of Object.entries(bucket)) {
        const event = normalizeHookEvent(eventKey);
        if (!event || !Array.isArray(entries)) {
            continue;
        }
        const normalized = entries.map(normalizeHookDefinition).filter(Boolean);
        if (normalized.length) {
            hooks[event] = [...(hooks[event] || []), ...normalized];
        }
    }
    return { hooks };
}

export function mergeHooksConfigs(...configs) {
    const merged = {};
    for (const config of configs) {
        if (!config?.hooks) {
            continue;
        }
        for (const [event, defs] of Object.entries(config.hooks)) {
            merged[event] = [...(merged[event] || []), ...defs];
        }
    }
    return { hooks: merged };
}

/** JavaScript RegExp matcher (Cursor / Claude Code style). */
export function hookMatcherMatches(matcher, query) {
    if (!matcher || !String(matcher).trim()) {
        return true;
    }
    if (query == null || query === "") {
        return false;
    }
    try {
        return new RegExp(matcher).test(String(query));
    } catch {
        return String(query).includes(matcher);
    }
}

export function hookMatchQueryForEvent(event, hookInput) {
    switch (event) {
        case "PreToolUse":
        case "PostToolUse":
        case "PostToolUseFailure":
            return hookInput.tool_name;
        case "BeforeShellExecution":
        case "AfterShellExecution":
            return hookInput.command;
        case "SubagentStart":
        case "SubagentStop":
            return hookInput.agent_type;
        case "SessionStart":
            return hookInput.source;
        case "UserPromptSubmit":
            return hookInput.prompt;
        default:
            return undefined;
    }
}
