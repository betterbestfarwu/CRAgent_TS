import fs from "node:fs";
import path from "node:path";
import { PLAN_REJECTION_PREFIX } from "@shared/planMessages.js";
import { classifyBashCommand } from "./bashSafety.js";

export { PLAN_REJECTION_PREFIX } from "@shared/planMessages.js";

export const PLANS_DIR = ".cragent/plans";

/** Tools exposed in plan mode (write_file is allowed only for the session plan path). */
export const PLAN_MODE_TOOL_NAMES = new Set([
    "read_file",
    "list_dir",
    "bash",
    "memory_get",
    "memory_search",
    "web_fetch",
    "load_skill",
    "tool_search",
    "write_file",
]);

const PLAN_MODE_BLOCKED_TOOLS = new Set([
    "TodoWrite",
    "Task",
    "download_skill",
    "delete_skill",
    "enter_plan_mode",
    "computer_screenshot",
    "computer_move",
    "computer_click",
    "computer_type",
    "computer_key",
    "computer_scroll",
]);

const PLAN_MODE_BASH_WRITE_PATTERNS = [
    /\s>>?\s/,
    /\s2>>?\s/,
    /\|\s*tee\b/i,
    /\btouch\b/i,
    /\bmkdir\b/i,
    /\brm\b/i,
    /\bmv\b/i,
    /\bcp\b/i,
    /\bchmod\b/i,
    /\bchown\b/i,
    /\bgit\s+(add|commit|push|reset|checkout|restore|clean|rebase)\b/i,
    /\bnpm\s+(install|i|uninstall|ci|publish)\b/i,
    /\byarn\s+(add|remove|install)\b/i,
    /\bpip\s+install\b/i,
];

export function getPlanFilePath(workspace, sessionId) {
    return path.join(workspace, PLANS_DIR, `${sessionId}.md`);
}

export function ensurePlansDirectory(workspace) {
    const dir = path.join(workspace, PLANS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

export function planFileExists(workspace, sessionId) {
    return fs.existsSync(getPlanFilePath(workspace, sessionId));
}

export function readPlanFile(workspace, sessionId) {
    const filePath = getPlanFilePath(workspace, sessionId);
    if (!fs.existsSync(filePath)) {
        return { filePath, content: null };
    }
    return { filePath, content: fs.readFileSync(filePath, "utf-8") };
}

export function getPlanDisplayPath(workspace, sessionId) {
    return path.join(PLANS_DIR, `${sessionId}.md`);
}

export function writePlanFile(workspace, sessionId, content) {
    ensurePlansDirectory(workspace);
    const filePath = getPlanFilePath(workspace, sessionId);
    fs.writeFileSync(filePath, String(content ?? ""), "utf-8");
    return filePath;
}

/** Heuristic for auto-entering plan mode from goal mode on delivery-style requests. */
export function shouldStartInPlanMode(input) {
    const text = String(input ?? "").trim();
    if (text.length < 10 || text.startsWith("/")) {
        return false;
    }
    const deliveryAction =
        /(?:开发|实现|搭建|创建|做一个|编写|设计|落地|重构|迁移|集成|build|implement|create|develop|scaffold)/i.test(
            text,
        );
    const deliveryTarget =
        /(?:小程序|应用|网站|系统|项目|功能|模块|服务|接口|app|application|website|service|api|feature|platform)/i.test(
            text,
        );
    return deliveryAction && deliveryTarget;
}

export function readPlanApprovalDraft(workspace, sessionId) {
    const filePath = getPlanFilePath(workspace, sessionId);
    const displayPath = getPlanDisplayPath(workspace, sessionId);
    const { content } = readPlanFile(workspace, sessionId);
    return {
        filePath,
        displayPath,
        content: content ?? "",
    };
}

export function buildPlanModeSystemPrompt({ planFilePath, planExists }) {
    const planFileInfo = planExists
        ? `A plan file already exists at ${planFilePath}. You may read and edit it with write_file.`
        : `No plan file exists yet. Create your plan at ${planFilePath} with write_file.`;

    return [
        "You are in Plan Mode.",
        "The user does not want implementation yet — do not change the codebase except the plan file.",
        "",
        "## Plan file",
        planFileInfo,
        "This is the ONLY file you may write. All other actions must be read-only.",
        "",
        "## Workflow",
        "1. Explore the codebase with read_file, list_dir, and read-only bash (ls, git status, git log, git diff, cat, head, tail, find, grep).",
        "2. Update the plan file incrementally as you learn — do not wait until the end.",
        "3. Ask clarifying questions in chat when code alone cannot resolve a decision.",
        "4. When the plan is ready, tell the user to click「开始执行」to approve the plan and switch to Goal mode.",
        "",
        "In Goal mode the model may call enter_plan_mode to return here for further planning.",
        "",
        "## Plan file structure",
        "- Context: why this change is needed",
        "- Steps: files to modify and what changes in each",
        "- Reuse: existing functions/utilities with paths",
        "- Verification: how to test end-to-end",
        "",
        "Do not claim you executed changes outside the plan file.",
    ].join("\n");
}

export function filterToolsForPlanMode(tools) {
    return tools.filter(
        (tool) =>
            PLAN_MODE_TOOL_NAMES.has(tool.name) && !PLAN_MODE_BLOCKED_TOOLS.has(tool.name),
    );
}

export function validatePlanModeToolCall(toolName, toolInput, planFilePath, workspace, resolvePath) {
    if (PLAN_MODE_BLOCKED_TOOLS.has(toolName)) {
        return `Error: ${toolName} is not available in plan mode`;
    }
    if (!PLAN_MODE_TOOL_NAMES.has(toolName)) {
        return `Error: ${toolName} is not available in plan mode`;
    }
    if (toolName === "write_file" && toolInput?.path != null) {
        const target = resolvePath(workspace, toolInput.path);
        const normalizedPlan = path.normalize(planFilePath);
        const normalizedTarget = path.normalize(target);
        if (normalizedTarget !== normalizedPlan) {
            return `Error: in plan mode you may only write the plan file (${planFilePath})`;
        }
    }
    return null;
}

/**
 * Stricter bash policy for plan mode: block write-class and state-changing commands.
 */
export function classifyBashForPlanMode(command, runtime) {
    const trimmed = String(command || "").trim();
    if (!trimmed) {
        return { kind: "blocked", reason: "empty command" };
    }
    const lower = trimmed.toLowerCase();
    for (const pattern of PLAN_MODE_BASH_WRITE_PATTERNS) {
        if (pattern.test(trimmed) || pattern.test(lower)) {
            return {
                kind: "blocked",
                reason: "plan mode allows read-only shell commands only",
            };
        }
    }
    const base = classifyBashCommand(trimmed, runtime);
    if (base.kind === "blocked") {
        return base;
    }
    if (base.kind === "needsConfirmation") {
        return {
            kind: "blocked",
            reason: `plan mode: ${base.reason} (read-only)`,
        };
    }
    return base;
}

export function buildPlanRejectionUserMessage(planContent, feedback) {
    const plan = planContent?.trim() || "(Plan file is empty.)";
    let message = `${PLAN_REJECTION_PREFIX}${plan}`;
    const trimmedFeedback = feedback?.trim();
    if (trimmedFeedback) {
        message += `\n\nUser feedback:\n${trimmedFeedback}`;
    }
    message +=
        "\n\nStay in plan mode. Update the plan file to address the feedback. Do not implement code changes until the user approves execution.";
    return message;
}

export function buildExitPlanModeUserMessage(planContent, planFilePath) {
    const body =
        planContent?.trim() ||
        "(Plan file is empty — review the conversation and plan file before executing.)";
    return [
        "请按以下已批准的计划开始实现。若计划不完整，先补齐再动手。",
        "",
        `Plan file: ${planFilePath}`,
        "",
        body,
    ].join("\n");
}
