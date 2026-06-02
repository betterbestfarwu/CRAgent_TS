import { SHELL_KIND } from "./shellRuntime.js";

const POSIX_BLOCKED = new Set([
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

const POSIX_CONFIRM = new Set([
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

const POSIX_DANGEROUS_PATTERNS = [
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

const WINDOWS_BLOCKED = new Set([
    "remove-item",
    "ri",
    "rm",
    "rmdir",
    "del",
    "erase",
    "format",
    "format.com",
    "shutdown",
    "restart-computer",
    "stop-computer",
    "iex",
    "invoke-expression",
    "taskkill",
    "bcdedit",
]);

const WINDOWS_CONFIRM = new Set([
    "copy-item",
    "copy",
    "cp",
    "move-item",
    "move",
    "mv",
    "npm",
    "yarn",
    "pip",
    "pnpm",
    "git",
    "make",
    "cmake",
    "tar",
    "compress-archive",
    "expand-archive",
]);

const WINDOWS_DANGEROUS_PATTERNS = [
    "remove-item -recurse c:\\",
    "del /s /q c:\\",
    "format c:",
    "shutdown /s",
    "bcdedit ",
    "-encodedcommand",
    "frombase64string",
];

/**
 * @param {import('./shellRuntime.js').ShellRuntime} runtime
 */
export function getShellPolicy(runtime) {
    if (runtime.kind === SHELL_KIND.POWERSHELL) {
        return {
            blockedCommands: WINDOWS_BLOCKED,
            confirmCommands: WINDOWS_CONFIRM,
            dangerousPatterns: WINDOWS_DANGEROUS_PATTERNS,
            normalizeToken: (token) => token.toLowerCase().replace(/\.exe$/i, ""),
        };
    }
    return {
        blockedCommands: POSIX_BLOCKED,
        confirmCommands: POSIX_CONFIRM,
        dangerousPatterns: POSIX_DANGEROUS_PATTERNS,
        normalizeToken: (token) => token,
    };
}
