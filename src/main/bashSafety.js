const BLOCKED_COMMANDS = new Set([
    "rm",
    "rmdir",
    "dd",
    "mkfs",
    "sudo",
    "shutdown",
    "reboot",
    "halt",
    "poweroff",
    "kill",
    "killall",
    "diskutil",
]);

const CONFIRM_COMMANDS = new Set([
    "cp",
    "mv",
    "chmod",
    "chown",
    "tar",
    "zip",
    "unzip",
    "npm",
    "yarn",
    "pip",
    "brew",
    "apt",
    "apt-get",
    "make",
    "xcodebuild",
    "ln",
    "git",
    "open",
]);

const DANGEROUS_PATTERNS = [
    ":(){",
    "> /dev/sd",
    "of=/dev/sd",
    "mkfs.",
    "format ",
    "/dev/disk",
    "shutdown -",
    "rm -rf /",
    "chmod 777 /",
    "chown -R / ",
];

export function classifyBashCommand(command) {
    const lower = command.toLowerCase();
    for (const pattern of DANGEROUS_PATTERNS) {
        if (lower.includes(pattern)) {
            return { kind: "blocked", reason: `matches dangerous pattern: ${pattern}` };
        }
    }

    const segments = command.split(/[|;&]/);
    for (const segment of segments) {
        const trimmed = segment.trim();
        if (!trimmed) {
            continue;
        }
        const head = trimmed.split(/\s+/)[0] || "";
        const token = head.includes("=") ? "" : head;
        if (BLOCKED_COMMANDS.has(token)) {
            return { kind: "blocked", reason: `'${token}' is a blocked command` };
        }
        if (token === "git") {
            const rest = trimmed.slice(token.length).trim();
            if (
                rest.startsWith("push") ||
                rest.startsWith("reset --hard") ||
                rest.startsWith("clean -fd") ||
                rest.startsWith("rebase")
            ) {
                return { kind: "needsConfirmation", reason: `git ${rest}` };
            }
            continue;
        }
        if (CONFIRM_COMMANDS.has(token)) {
            return { kind: "needsConfirmation", reason: `'${token}' is a write-class command` };
        }
    }

    return { kind: "allowed" };
}
