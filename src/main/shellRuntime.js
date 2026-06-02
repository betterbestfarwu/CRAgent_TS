import fs from "node:fs";

/** @typedef {'zsh' | 'bash' | 'powershell'} ShellKind */

/**
 * @typedef {Object} ShellRuntime
 * @property {ShellKind} kind
 * @property {string} executable
 * @property {string[]} argsPrefix Arguments before the command string (e.g. `-c` or `-Command`)
 * @property {string} label Human-readable shell name for UI
 * @property {RegExp} segmentSeparator Splits compound commands for policy checks
 */

export const SHELL_KIND = {
    ZSH: "zsh",
    BASH: "bash",
    POWERSHELL: "powershell",
};

const POSIX_CANDIDATES = [
    { kind: SHELL_KIND.ZSH, path: "/bin/zsh" },
    { kind: SHELL_KIND.BASH, path: "/bin/bash" },
];

/**
 * Resolve the shell used by the `bash` tool on this machine.
 * @param {string} [platform] Defaults to `process.platform`
 * @returns {ShellRuntime}
 */
export function resolveShellRuntime(platform = process.platform) {
    if (platform === "win32") {
        return resolveWindowsShell();
    }
    return resolvePosixShell(platform);
}

function resolveWindowsShell() {
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    const candidates = [
        process.env.PWSH_PATH,
        `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
        "powershell.exe",
    ].filter(Boolean);

    for (const executable of candidates) {
        if (executable.includes("\\") || executable.includes("/")) {
            if (!fs.existsSync(executable)) continue;
        }
        return {
            kind: SHELL_KIND.POWERSHELL,
            executable,
            argsPrefix: [
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
            ],
            label: "PowerShell",
            segmentSeparator: /[;|]/,
        };
    }

    throw new Error("PowerShell not found on Windows (expected powershell.exe)");
}

function resolvePosixShell(platform) {
    const preferZsh = platform === "darwin";
    const ordered = preferZsh
        ? POSIX_CANDIDATES
        : [...POSIX_CANDIDATES].reverse();

    for (const { kind, path } of ordered) {
        if (fs.existsSync(path)) {
            return {
                kind,
                executable: path,
                argsPrefix: ["-c"],
                label: kind === SHELL_KIND.ZSH ? "Zsh" : "Bash",
                segmentSeparator: /[|;&]/,
            };
        }
    }

    throw new Error("No POSIX shell found (/bin/zsh or /bin/bash)");
}

/**
 * @param {ShellRuntime} runtime
 * @returns {string}
 */
export function describeShellInvocation(runtime) {
    const flag = runtime.argsPrefix[runtime.argsPrefix.length - 1];
    return `${runtime.executable} ${runtime.argsPrefix.slice(0, -1).join(" ")} ${flag}`.trim();
}
