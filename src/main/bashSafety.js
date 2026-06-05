import os from "node:os";
import path from "node:path";
import { scanShellSecurity } from "./shellSecurity.js";
import { getShellPolicy } from "./shellPolicy.js";
import { resolveShellRuntime, SHELL_KIND } from "./shellRuntime.js";

const POSIX_COMMAND_SEPARATORS = new Set([";", "|", "&", "&&", "||", "\n"]);
const POSIX_GROUP_START = new Set(["(", "{"]);
const POSIX_PRECOMMAND_MODIFIERS = new Set([
    "command",
    "builtin",
    "noglob",
    "nocorrect",
    "time",
]);
const POSIX_CONTROL_WORDS = new Set([
    "if",
    "then",
    "else",
    "elif",
    "fi",
    "for",
    "while",
    "until",
    "case",
    "esac",
    "select",
    "do",
    "done",
    "function",
]);
const POSIX_CONTROL_COMMAND_STARTERS = new Set(["then", "else", "elif", "do"]);
const INLINE_EXECUTION_FLAGS = new Map([
    ["sh", new Set(["-c"])],
    ["bash", new Set(["-c"])],
    ["zsh", new Set(["-c"])],
    ["dash", new Set(["-c"])],
    ["ksh", new Set(["-c"])],
    ["fish", new Set(["-c"])],
    ["python", new Set(["-c"])],
    ["python3", new Set(["-c"])],
    ["perl", new Set(["-e"])],
    ["ruby", new Set(["-e"])],
    ["node", new Set(["-e", "--eval", "-p", "--print"])],
    ["osascript", new Set(["-e"])],
]);
const EXTERNAL_WRITE_COMMANDS = new Set([
    "cp",
    "mv",
    "touch",
    "mkdir",
    "tee",
    "chmod",
    "chown",
    "ln",
    "tar",
    "zip",
    "unzip",
    "sed",
]);
const PATH_READ_COMMANDS = new Set([
    "cat",
    "less",
    "more",
    "head",
    "tail",
    "grep",
    "rg",
    "sed",
    "awk",
    "find",
    "ls",
]);

function tokenizePosixShell(command) {
    const tokens = [];
    let buf = "";
    let quote = null;
    let escaped = false;
    let quoted = false;

    const pushWord = () => {
        if (!buf) return;
        tokens.push({ type: "word", value: buf, quoted });
        buf = "";
        quoted = false;
    };

    for (let i = 0; i < command.length; i++) {
        const char = command[i];

        if (escaped) {
            buf += char;
            escaped = false;
            continue;
        }

        if (quote) {
            if (char === "\\" && quote !== "'") {
                escaped = true;
                continue;
            }
            if (char === quote) {
                quote = null;
                quoted = true;
                continue;
            }
            buf += char;
            continue;
        }

        if (char === "\\" ) {
            escaped = true;
            continue;
        }
        if (char === "'" || char === '"') {
            quote = char;
            quoted = true;
            continue;
        }
        if (char === "\n" || char === "\r") {
            pushWord();
            tokens.push({ type: "op", value: "\n" });
            continue;
        }
        if (/\s/.test(char)) {
            pushWord();
            continue;
        }
        if (";|&<>(){}".includes(char)) {
            pushWord();
            const next = command[i + 1];
            if ((char === "&" && next === "&") || (char === "|" && next === "|")) {
                tokens.push({ type: "op", value: `${char}${next}` });
                i++;
            } else if (char === ">" && next === ">") {
                tokens.push({ type: "op", value: ">>" });
                i++;
            } else {
                tokens.push({ type: "op", value: char });
            }
            continue;
        }
        buf += char;
    }

    pushWord();
    return tokens;
}

function isAssignmentToken(token) {
    return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function commandName(rawToken, runtime, policy) {
    const normalizedSeparators = String(rawToken || "").replace(/\\/g, "/");
    const base = normalizedSeparators.split("/").pop() || normalizedSeparators;
    return policy.normalizeToken(base);
}

function segmentRest(tokens, index) {
    const rest = [];
    for (let i = index + 1; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.type === "op" && POSIX_COMMAND_SEPARATORS.has(token.value)) break;
        if (token.type === "word") rest.push(token.value);
    }
    return rest.join(" ");
}

function isEnvOptionWithArgument(value) {
    return (
        value === "-u" ||
        value === "--unset" ||
        value === "-C" ||
        value === "--chdir" ||
        value === "-S" ||
        value === "--split-string" ||
        /^-[^-].*[uCS]/.test(value)
    );
}

function findEffectiveCommandIndex(tokens, start, runtime, policy) {
    let i = start;
    while (i < tokens.length) {
        const token = tokens[i];
        if (token.type === "op" && POSIX_GROUP_START.has(token.value)) {
            i++;
            continue;
        }
        if (token.type !== "word") return -1;

        const name = commandName(token.value, runtime, policy);
        if (isAssignmentToken(token.value) || POSIX_PRECOMMAND_MODIFIERS.has(name)) {
            i++;
            continue;
        }

        if (name === "env") {
            i++;
            while (i < tokens.length && tokens[i]?.type === "word") {
                const value = tokens[i].value;
                if (isAssignmentToken(value)) {
                    i++;
                    continue;
                }
                if (value.startsWith("-")) {
                    const skipNext = isEnvOptionWithArgument(value);
                    i += skipNext ? 2 : 1;
                    continue;
                }
                break;
            }
            continue;
        }

        return i;
    }
    return -1;
}

function findInlineScript(tokens, commandIndex, commandNameValue) {
    const flags = INLINE_EXECUTION_FLAGS.get(commandNameValue);
    if (!flags) return null;

    for (let i = commandIndex + 1; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.type === "op" && POSIX_COMMAND_SEPARATORS.has(token.value)) break;
        if (token.type !== "word") continue;

        const value = token.value;
        const hasInlineFlag =
            flags.has(value) ||
            (flags.has("-c") && /^-[A-Za-z]*c[A-Za-z]*$/.test(value));
        if (!hasInlineFlag) continue;

        for (let j = i + 1; j < tokens.length; j++) {
            const scriptToken = tokens[j];
            if (scriptToken.type === "op" && POSIX_COMMAND_SEPARATORS.has(scriptToken.value)) {
                return null;
            }
            if (scriptToken.type === "word") return scriptToken.value;
        }
        return null;
    }
    return null;
}

function classifyGitCommand(rest, runtime) {
    if (
        /^push\b/i.test(rest) ||
        /^reset\s+--hard/i.test(rest) ||
        /^clean\s+-fd/i.test(rest) ||
        /^rebase\b/i.test(rest)
    ) {
        return {
            kind: "needsConfirmation",
            reason: `git ${rest}`,
            shellKind: runtime.kind,
        };
    }
    return null;
}

function classifyFindCommand(rest, runtime, policy) {
    if (/(?:^|\s)-delete(?:\s|$)/.test(rest)) {
        return {
            kind: "blocked",
            reason: "find -delete can remove files",
            shellKind: runtime.kind,
        };
    }

    const execMatch = rest.match(/(?:^|\s)-exec(?:dir)?\s+([^\s;]+)/);
    if (!execMatch) return null;

    const execCommand = commandName(execMatch[1], runtime, policy);
    if (policy.blockedCommands.has(execCommand)) {
        return {
            kind: "blocked",
            reason: `find -exec '${execMatch[1]}' is blocked`,
            shellKind: runtime.kind,
        };
    }
    return {
        kind: "needsConfirmation",
        reason: "find -exec can run another command",
        shellKind: runtime.kind,
    };
}

function classifyXargsCommand(rest, runtime, policy) {
    const words = rest.split(/\s+/).filter(Boolean);
    for (const word of words) {
        if (word.startsWith("-")) continue;
        const name = commandName(word, runtime, policy);
        if (policy.blockedCommands.has(name)) {
            return {
                kind: "blocked",
                reason: `xargs '${word}' is blocked`,
                shellKind: runtime.kind,
            };
        }
        break;
    }
    return {
        kind: "needsConfirmation",
        reason: "xargs can run another command",
        shellKind: runtime.kind,
    };
}

function hasDestructiveInlineText(script) {
    const text = String(script || "").toLowerCase();
    return (
        /\brm\s+-[^\n;'"`]*[rf]/.test(text) ||
        /\b(?:sudo|dd|mkfs|diskutil|shutdown|reboot|halt|poweroff)\b/.test(text)
    );
}

function classifyAwkCommand(rest, runtime) {
    if (!/\bsystem\s*\(/.test(rest)) return null;
    if (hasDestructiveInlineText(rest)) {
        return {
            kind: "blocked",
            reason: "awk system() contains destructive command text",
            shellKind: runtime.kind,
        };
    }
    return {
        kind: "needsConfirmation",
        reason: "awk system() can run another command",
        shellKind: runtime.kind,
    };
}

function classifyPosixCommandPolicy(command, runtime, policy, options, depth) {
    const tokens = tokenizePosixShell(command);
    let expectCommand = true;
    let sawShellControl = false;
    let hasExternalWriteCommand = false;
    let hasPathReadCommand = false;
    let hasOutputRedirection = false;

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        if (token.type === "op") {
            if (token.value === ">" || token.value === ">>") {
                hasOutputRedirection = true;
            }
            if (POSIX_COMMAND_SEPARATORS.has(token.value) || POSIX_GROUP_START.has(token.value)) {
                expectCommand = true;
            }
            continue;
        }

        const wordName = commandName(token.value, runtime, policy);
        if (POSIX_CONTROL_WORDS.has(wordName)) {
            sawShellControl = true;
            if (POSIX_CONTROL_COMMAND_STARTERS.has(wordName)) {
                expectCommand = true;
            }
            continue;
        }

        if (!expectCommand) continue;

        const commandIndex = findEffectiveCommandIndex(tokens, i, runtime, policy);
        if (commandIndex < 0) break;
        i = commandIndex;

        const rawToken = tokens[commandIndex].value;
        const tokenName = commandName(rawToken, runtime, policy);
        const rest = segmentRest(tokens, commandIndex);
        expectCommand = false;

        if (EXTERNAL_WRITE_COMMANDS.has(tokenName)) {
            hasExternalWriteCommand = true;
        }
        if (PATH_READ_COMMANDS.has(tokenName)) {
            hasPathReadCommand = true;
        }

        if (policy.blockedCommands.has(tokenName)) {
            return {
                result: {
                    kind: "blocked",
                    reason: `'${rawToken}' is a blocked command`,
                    shellKind: runtime.kind,
                },
                tokens,
            };
        }

        if (tokenName === "git") {
            const gitResult = classifyGitCommand(rest, runtime);
            if (gitResult) return { result: gitResult, tokens };
            continue;
        }

        if (tokenName === "find") {
            const findResult = classifyFindCommand(rest, runtime, policy);
            if (findResult) return { result: findResult, tokens };
        }

        if (tokenName === "xargs") {
            return { result: classifyXargsCommand(rest, runtime, policy), tokens };
        }

        if (tokenName === "awk") {
            const awkResult = classifyAwkCommand(rest, runtime);
            if (awkResult) return { result: awkResult, tokens };
        }

        const inlineScript = findInlineScript(tokens, commandIndex, tokenName);
        if (inlineScript != null) {
            if (hasDestructiveInlineText(inlineScript)) {
                return {
                    result: {
                        kind: "blocked",
                        reason: `${rawToken} inline script contains destructive command text`,
                        shellKind: runtime.kind,
                    },
                    tokens,
                };
            }
            if (depth >= 2) {
                return {
                    result: {
                        kind: "needsConfirmation",
                        reason: `'${rawToken}' executes inline script`,
                        shellKind: runtime.kind,
                    },
                    tokens,
                };
            }
            const nested = classifyBashCommand(inlineScript, runtime, {
                ...options,
                _depth: depth + 1,
            });
            if (nested.kind === "blocked") {
                return {
                    result: {
                        ...nested,
                        reason: `${rawToken} inline script: ${nested.reason}`,
                    },
                    tokens,
                };
            }
            return {
                result: {
                    kind: "needsConfirmation",
                    reason: `'${rawToken}' executes inline script`,
                    shellKind: runtime.kind,
                },
                tokens,
            };
        }

        if (policy.confirmCommands.has(tokenName)) {
            return {
                result: {
                    kind: "needsConfirmation",
                    reason: `'${rawToken}' is a write-class command`,
                    shellKind: runtime.kind,
                },
                tokens,
                hasExternalWriteCommand,
                hasPathReadCommand,
                hasOutputRedirection,
            };
        }
    }

    if (sawShellControl) {
        return {
            result: {
                kind: "needsConfirmation",
                reason: "shell control flow requires confirmation",
                shellKind: runtime.kind,
            },
            tokens,
        };
    }

    return {
        result: null,
        tokens,
        hasExternalWriteCommand,
        hasPathReadCommand,
        hasOutputRedirection,
    };
}

function classifySimpleCommandPolicy(command, runtime, policy) {
    const segments = command.split(runtime.segmentSeparator);
    for (const segment of segments) {
        const trimmed = segment.trim();
        if (!trimmed) continue;

        const head = trimmed.split(/\s+/)[0] || "";
        const rawToken = head.includes("=") ? "" : head.replace(/^['"]|['"]$/g, "");
        const token = policy.normalizeToken(rawToken);

        if (policy.blockedCommands.has(token)) {
            return {
                kind: "blocked",
                reason: `'${rawToken}' is a blocked command`,
                shellKind: runtime.kind,
            };
        }

        if (token === "git") {
            const rest = trimmed.slice(head.length).trim();
            const gitResult = classifyGitCommand(rest, runtime);
            if (gitResult) return gitResult;
            continue;
        }

        if (policy.confirmCommands.has(token)) {
            return {
                kind: "needsConfirmation",
                reason: `'${rawToken}' is a write-class command`,
                shellKind: runtime.kind,
            };
        }
    }
    return null;
}

function expandTilde(input) {
    const raw = String(input || "");
    if (raw === "~") return os.homedir();
    if (raw.startsWith("~/")) return path.join(os.homedir(), raw.slice(2));
    return raw;
}

function isUrlLike(value) {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function stripPathDecorators(value) {
    return String(value || "")
        .replace(/^[=:,]+/, "")
        .replace(/[),.;]+$/, "");
}

function isUnderRoot(root, target) {
    const resolvedRoot = path.resolve(expandTilde(root));
    const resolvedTarget = path.resolve(expandTilde(target));
    return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
}

function classifyWorkspacePathRisk(command, runtime, tokens, policyInfo, workspace) {
    const workspaceRoot = String(workspace || "").trim();
    if (!workspaceRoot || runtime.kind === SHELL_KIND.POWERSHELL) return null;

    const candidatePaths = [];
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.type !== "word") continue;
        const value = stripPathDecorators(token.value);
        if (!value || isUrlLike(value) || value === "/dev/null") continue;
        if (value.startsWith("/") || value === "~" || value.startsWith("~/")) {
            candidatePaths.push({ value, index: i });
        }
    }

    for (const candidate of candidatePaths) {
        if (isUnderRoot(workspaceRoot, candidate.value)) continue;

        const isWrite =
            policyInfo?.hasExternalWriteCommand ||
            policyInfo?.hasOutputRedirection ||
            /(?:^|[\s|;])tee(?:\s|$)/.test(command);
        if (isWrite) {
            return {
                kind: "blocked",
                reason: `external path write is blocked: ${candidate.value}`,
                shellKind: runtime.kind,
            };
        }

        return {
            kind: "needsConfirmation",
            reason: `external path access: ${candidate.value}`,
            shellKind: runtime.kind,
        };
    }

    return null;
}

/**
 * Classify a shell command for the `bash` tool (security scan + command policy).
 * @param {string} command
 * @param {import('./shellRuntime.js').ShellRuntime} [runtime] Defaults to `resolveShellRuntime()`
 * @param {{ workspace?: string, _depth?: number }} [options]
 */
export function classifyBashCommand(command, runtime = resolveShellRuntime(), options = {}) {
    const commandText = String(command || "");
    const depth = Number(options._depth) || 0;
    const security = scanShellSecurity(command, runtime);
    const policy = getShellPolicy(runtime);
    const lower = commandText.toLowerCase();
    for (const pattern of policy.dangerousPatterns) {
        if (lower.includes(pattern.toLowerCase())) {
            return {
                kind: "blocked",
                reason: `matches dangerous pattern: ${pattern}`,
                shellKind: runtime.kind,
            };
        }
    }

    if (runtime.kind === SHELL_KIND.POWERSHELL && !security.ok) {
        return {
            kind: "needsConfirmation",
            reason: security.message,
            securityCheckId: security.checkId,
            shellKind: runtime.kind,
        };
    }

    const policyScan =
        runtime.kind === SHELL_KIND.POWERSHELL
            ? { result: classifySimpleCommandPolicy(commandText, runtime, policy), tokens: [] }
            : classifyPosixCommandPolicy(commandText, runtime, policy, options, depth);
    const pathRisk = classifyWorkspacePathRisk(
        commandText,
        runtime,
        policyScan.tokens || [],
        policyScan,
        options.workspace,
    );

    if (policyScan.result?.kind === "blocked") return policyScan.result;
    if (pathRisk?.kind === "blocked") return pathRisk;

    if (!security.ok) {
        return {
            kind: "needsConfirmation",
            reason: security.message,
            securityCheckId: security.checkId,
            shellKind: runtime.kind,
        };
    }
    if (policyScan.result) return policyScan.result;
    if (pathRisk) return pathRisk;

    return { kind: "allowed", shellKind: runtime.kind };
}

export { SHELL_KIND, resolveShellRuntime };
