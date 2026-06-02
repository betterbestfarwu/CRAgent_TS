import { scanShellSecurity } from "./shellSecurity.js";
import { getShellPolicy } from "./shellPolicy.js";
import { resolveShellRuntime, SHELL_KIND } from "./shellRuntime.js";

/**
 * Classify a shell command for the `bash` tool (security scan + command policy).
 * @param {string} command
 * @param {import('./shellRuntime.js').ShellRuntime} [runtime] Defaults to `resolveShellRuntime()`
 */
export function classifyBashCommand(command, runtime = resolveShellRuntime()) {
    const security = scanShellSecurity(command, runtime);
    if (!security.ok) {
        return {
            kind: "needsConfirmation",
            reason: security.message,
            securityCheckId: security.checkId,
            shellKind: runtime.kind,
        };
    }

    const policy = getShellPolicy(runtime);
    const lower = command.toLowerCase();
    for (const pattern of policy.dangerousPatterns) {
        if (lower.includes(pattern.toLowerCase())) {
            return {
                kind: "blocked",
                reason: `matches dangerous pattern: ${pattern}`,
                shellKind: runtime.kind,
            };
        }
    }

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

    return { kind: "allowed", shellKind: runtime.kind };
}

export { SHELL_KIND, resolveShellRuntime };
