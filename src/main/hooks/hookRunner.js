import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
    hookMatcherMatches,
    hookMatchQueryForEvent,
    parseHooksFileJson,
} from "@shared/hooksConfig.js";

const DEFAULT_TIMEOUT_SEC = 30;
const MAX_STDOUT_BYTES = 512 * 1024;

function hooksDisabled() {
    const v = process.env.CRAGENT_DISABLE_HOOKS;
    return v === "1" || v === "true";
}

function readHooksFile(filePath) {
    try {
        const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        return parseHooksFileJson(raw);
    } catch {
        return { hooks: {} };
    }
}

function resolveCommand(command, hookRoot) {
    let trimmed = String(command || "").trim();
    if (!trimmed) {
        return trimmed;
    }
    // Legacy hooks.json used .cragent/hooks/… before flat hooks.json layout.
    if (trimmed.startsWith(".cragent/hooks/")) {
        trimmed = trimmed.replace(/^\.cragent\/hooks\//, "hooks/");
    } else if (trimmed.startsWith(".cragent/")) {
        trimmed = trimmed.replace(/^\.cragent\//, "");
    }
    if (path.isAbsolute(trimmed)) {
        return trimmed;
    }
    return path.resolve(hookRoot, trimmed);
}

function parseHookStdout(stdout, exitCode, stderr, failClosed) {
    if (exitCode === 2) {
        return {
            blocked: true,
            reason: stderr?.trim() || stdout?.trim() || "Hook blocked (exit code 2)",
        };
    }
    if (exitCode !== 0) {
        if (failClosed) {
            return {
                blocked: true,
                reason: stderr?.trim() || `Hook failed with exit code ${exitCode}`,
            };
        }
        return {};
    }

    const text = String(stdout || "").trim();
    if (!text) {
        return {};
    }

    let json;
    try {
        json = JSON.parse(text);
    } catch {
        if (failClosed) {
            return { blocked: true, reason: "Hook stdout is not valid JSON" };
        }
        return { stdout: text };
    }

    const out = {};

    if (json.permission === "deny" || json.permission === "block") {
        out.blocked = true;
        out.reason =
            json.user_message || json.agent_message || json.message || "Blocked by hook";
    }
    if (json.decision === "block") {
        out.blocked = true;
        out.reason = json.reason || out.reason || "Blocked by hook";
    }
    if (json.continue === false) {
        out.blocked = true;
        out.reason = json.stopReason || json.reason || out.reason || "Stopped by hook";
    }

    const specific = json.hookSpecificOutput;
    if (specific && typeof specific === "object") {
        if (specific.permissionDecision === "deny") {
            out.blocked = true;
            out.reason =
                specific.permissionDecisionReason ||
                json.reason ||
                out.reason ||
                "Blocked by hook";
        }
        if (specific.updatedInput && typeof specific.updatedInput === "object") {
            out.updatedInput = specific.updatedInput;
        }
        if (specific.additionalContext) {
            out.additionalContext = String(specific.additionalContext);
        }
        if (specific.updatedMCPToolOutput !== undefined) {
            out.updatedToolOutput = specific.updatedMCPToolOutput;
        }
    }

    if (json.updated_input && typeof json.updated_input === "object") {
        out.updatedInput = json.updated_input;
    }
    if (json.additional_context) {
        out.additionalContext = String(json.additional_context);
    }
    if (json.followup_message) {
        out.followupMessage = String(json.followup_message);
    }
    if (json.systemMessage) {
        out.systemMessage = String(json.systemMessage);
    }

    return out;
}

function runCommandHook(def, hookInput, hookRoot, timeoutSec, signal) {
    const command = resolveCommand(def.command, hookRoot);
    const timeoutMs = (def.timeout ?? timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000;
    const jsonInput = JSON.stringify(hookInput);

    return new Promise((resolve) => {
        const child = spawn(command, {
            cwd: hookRoot,
            shell: true,
            env: {
                ...process.env,
                CRAGENT_HOOK_EVENT: hookInput.hook_event_name,
                CRAGENT_SESSION_ID: hookInput.session_id,
                CRAGENT_PROJECT_ROOT: hookRoot,
            },
            stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        let settled = false;

        const finish = (result) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener?.("abort", onAbort);
            resolve(result);
        };

        const onAbort = () => {
            child.kill("SIGTERM");
            finish({ aborted: true });
        };
        if (signal?.aborted) {
            onAbort();
            return;
        }
        signal?.addEventListener?.("abort", onAbort, { once: true });

        child.stdout?.on("data", (chunk) => {
            if (stdout.length < MAX_STDOUT_BYTES) {
                stdout += String(chunk);
            }
        });
        child.stderr?.on("data", (chunk) => {
            stderr += String(chunk);
        });

        child.on("error", (error) => {
            finish({
                exitCode: 1,
                stdout: "",
                stderr: error.message,
            });
        });

        child.on("close", (code) => {
            finish({
                exitCode: code ?? 1,
                stdout,
                stderr,
            });
        });

        child.stdin?.write(jsonInput);
        child.stdin?.end();

        const timer = setTimeout(() => {
            child.kill("SIGTERM");
            finish({
                exitCode: 124,
                stdout,
                stderr: `${stderr}\nHook timed out after ${timeoutMs}ms`.trim(),
            });
        }, timeoutMs);
    });
}

export class HookRunner {
    constructor({ getHooksConfig, getSessionMeta, isEnabled = () => true, onHookEvent = null }) {
        this.getHooksConfig = getHooksConfig;
        this.getSessionMeta = getSessionMeta;
        this.isEnabled = isEnabled;
        this.onHookEvent = onHookEvent;
        this.cache = new Map();
    }

    emitHookEvent(entry) {
        if (typeof this.onHookEvent === "function") {
            this.onHookEvent(entry);
        }
    }

    invalidate() {
        this.cache.clear();
    }

    loadConfig(resolved) {
        const hooksFile = resolved?.hooksFile || null;
        const hookRoot = resolved?.hookRoot || process.cwd();
        const key = hooksFile || "_none_";
        const sig = hooksFile && fs.existsSync(hooksFile) ? fs.statSync(hooksFile).mtimeMs : 0;
        let cached = this.cache.get(key);
        if (cached && cached.sig === sig) {
            return cached.config;
        }

        const withRoots = (config, root) => {
            const hooks = {};
            for (const [event, defs] of Object.entries(config.hooks || {})) {
                hooks[event] = defs.map((def) => ({ ...def, hookRoot: root }));
            }
            return { hooks };
        };

        const projectConfig =
            hooksFile && fs.existsSync(hooksFile) ? readHooksFile(hooksFile) : { hooks: {} };
        const config = withRoots(projectConfig, hookRoot);

        this.cache.set(key, { sig, config });
        return config;
    }

    /**
     * Run all matching hooks for an event. Returns aggregated effects.
     */
    async run(event, hookInput, options = {}) {
        if (hooksDisabled() || !this.isEnabled()) {
            return {};
        }

        const resolved = this.getHooksConfig(hookInput.session_id);
        const config = this.loadConfig(resolved);
        const defs = config.hooks[event];
        if (!defs?.length) {
            return {};
        }

        const matchQuery =
            options.matchQuery !== undefined
                ? options.matchQuery
                : hookMatchQueryForEvent(event, hookInput);

        const matched = defs.filter((def) => hookMatcherMatches(def.matcher, matchQuery));
        if (!matched.length) {
            return {};
        }

        const aggregated = {};
        const signal = options.signal;
        const sessionId = hookInput.session_id;

        for (const def of matched) {
            if (def.type === "prompt") {
                this.emitHookEvent({
                    sessionId,
                    event,
                    command: def.prompt,
                    matchQuery,
                    status: "skipped",
                    detail: "prompt hooks are not supported yet",
                    timestamp: new Date().toISOString(),
                });
                continue;
            }

            const startedAt = Date.now();
            const logId = `${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
            this.emitHookEvent({
                id: logId,
                sessionId,
                event,
                command: def.command,
                matchQuery,
                status: "running",
                timestamp: new Date().toISOString(),
            });

            const runResult = await runCommandHook(
                def,
                hookInput,
                def.hookRoot,
                def.timeout,
                signal,
            );

            if (runResult.aborted) {
                aggregated.aborted = true;
                this.emitHookEvent({
                    id: logId,
                    sessionId,
                    event,
                    command: def.command,
                    matchQuery,
                    status: "cancelled",
                    durationMs: Date.now() - startedAt,
                    timestamp: new Date().toISOString(),
                });
                break;
            }

            const parsed = parseHookStdout(
                runResult.stdout,
                runResult.exitCode,
                runResult.stderr,
                def.failClosed,
            );

            this.emitHookEvent({
                id: logId,
                sessionId,
                event,
                command: def.command,
                matchQuery,
                status: parsed.blocked
                    ? "blocked"
                    : runResult.exitCode !== 0
                      ? "error"
                      : "success",
                exitCode: runResult.exitCode,
                durationMs: Date.now() - startedAt,
                blocked: Boolean(parsed.blocked),
                reason: parsed.reason,
                detail: parsed.blocked
                    ? parsed.reason
                    : runResult.exitCode !== 0
                      ? runResult.stderr?.trim() || `exit ${runResult.exitCode}`
                      : undefined,
                timestamp: new Date().toISOString(),
            });

            if (parsed.blocked) {
                aggregated.blocked = true;
                aggregated.reason = parsed.reason;
                break;
            }
            if (parsed.updatedInput) {
                aggregated.updatedInput = parsed.updatedInput;
            }
            if (parsed.additionalContext) {
                aggregated.additionalContexts = aggregated.additionalContexts || [];
                aggregated.additionalContexts.push(parsed.additionalContext);
            }
            if (parsed.updatedToolOutput !== undefined) {
                aggregated.updatedToolOutput = parsed.updatedToolOutput;
            }
            if (parsed.followupMessage) {
                aggregated.followupMessage = parsed.followupMessage;
            }
            if (parsed.systemMessage) {
                aggregated.systemMessage = parsed.systemMessage;
            }
        }

        if (aggregated.additionalContexts?.length) {
            aggregated.additionalContext = aggregated.additionalContexts.join("\n\n");
        }

        return aggregated;
    }

    buildBaseInput(sessionId, event, extra = {}) {
        const meta = this.getSessionMeta(sessionId);
        return {
            session_id: sessionId,
            transcript_path: meta.transcriptPath,
            cwd: meta.cwd,
            permission_mode: meta.permissionMode || "default",
            hook_event_name: event,
            ...extra,
        };
    }
}
