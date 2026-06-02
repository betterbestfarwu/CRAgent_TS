/**
 * PowerShell-oriented security checks (same check IDs as posix scanner where applicable).
 */

import { BASH_SECURITY_CHECK_IDS } from "./bashSecurityChecks.js";

const CHECK_LABELS = {
    [BASH_SECURITY_CHECK_IDS.BACKSLASH_ESCAPED_WHITESPACE]: "反斜杠空白",
    [BASH_SECURITY_CHECK_IDS.EMBEDDED_NEWLINE]: "嵌入换行",
    [BASH_SECURITY_CHECK_IDS.INCOMPLETE_COMMAND]: "不完整命令",
    [BASH_SECURITY_CHECK_IDS.BRACE_EXPANSION]: "花括号展开",
    [BASH_SECURITY_CHECK_IDS.COMMAND_SUBSTITUTION]: "命令替换",
    [BASH_SECURITY_CHECK_IDS.JQ_SYSTEM]: "jq system()",
    [BASH_SECURITY_CHECK_IDS.IO_REDIRECTION]: "I/O 重定向",
    [BASH_SECURITY_CHECK_IDS.CONTROL_CHARACTERS]: "控制字符",
    [BASH_SECURITY_CHECK_IDS.JQ_FILE_ARGUMENTS]: "jq 文件参数",
    [BASH_SECURITY_CHECK_IDS.IFS_INJECTION]: "IFS 注入",
    [BASH_SECURITY_CHECK_IDS.UNICODE_WHITESPACE]: "Unicode 伪装",
    [BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS]: "混淆标志",
    [BASH_SECURITY_CHECK_IDS.GIT_COMMIT_SUBSTITUTION]: "Git commit 替换",
    [BASH_SECURITY_CHECK_IDS.HASH_COMMENT]: "哈希注释",
    [BASH_SECURITY_CHECK_IDS.SHELL_METACHARACTERS]: "Shell 元字符",
    [BASH_SECURITY_CHECK_IDS.ZSH_DANGEROUS_COMMANDS]: "Zsh 危险命令",
    [BASH_SECURITY_CHECK_IDS.PROC_ACCESS]: "/proc 访问",
    [BASH_SECURITY_CHECK_IDS.DANGEROUS_VARIABLES]: "危险变量",
    [BASH_SECURITY_CHECK_IDS.TOKEN_INJECTION]: "Token 注入",
    [BASH_SECURITY_CHECK_IDS.BACKSLASH_ESCAPED_OPERATORS]: "反斜杠运算符",
};

// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

const UNICODE_WS_RE =
    /[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]/;

const PS_DANGEROUS_COMMANDS = new Set([
    "invoke-expression",
    "iex",
    "invoke-command",
    "icm",
    "start-process",
    "saps",
    "reg",
    "reg.exe",
    "format",
    "format.com",
    "shutdown",
    "restart-computer",
    "stop-computer",
    "remove-item",
    "ri",
    "rm",
    "rmdir",
    "del",
    "erase",
]);

const PS_OPERATORS = new Set([";", "|", "&", "<", ">"]);

function fail(checkId, message) {
    const label = CHECK_LABELS[checkId] || checkId;
    return { ok: false, checkId, label, message: `${label}: ${message}` };
}

function extractBaseCommand(command) {
    const trimmed = command.trim();
    const callOp = trimmed.match(/^&\s+(.+)$/s);
    const body = callOp ? callOp[1].trim() : trimmed;
    const token = body.split(/\s+/)[0] || "";
    return token.replace(/^['"]|['"]$/g, "");
}

function buildContext(command) {
    return {
        originalCommand: command,
        baseCommand: extractBaseCommand(command),
        lower: command.toLowerCase(),
    };
}

function checkControlCharacters(ctx) {
    if (CONTROL_CHAR_RE.test(ctx.originalCommand)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.CONTROL_CHARACTERS,
            "command contains non-printable control characters",
        );
    }
    return null;
}

function checkBacktickEscapedWhitespace(ctx) {
    if (/`[ \t]/.test(ctx.originalCommand)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.BACKSLASH_ESCAPED_WHITESPACE,
            "backtick before whitespace can hide command boundaries in PowerShell",
        );
    }
    return null;
}

function checkEmbeddedNewline(ctx) {
    if (/`r?`n|[\n\r]/.test(ctx.originalCommand)) {
        const lines = ctx.originalCommand.split(/\r?\n/);
        if (lines.length > 1 && lines.some((line, i) => i > 0 && line.trim() && !line.trim().startsWith("#"))) {
            return fail(
                BASH_SECURITY_CHECK_IDS.EMBEDDED_NEWLINE,
                "multiline PowerShell may run additional statements",
            );
        }
    }
    return null;
}

function checkIncompleteCommand(ctx) {
    const trimmed = ctx.originalCommand.trim();
    if (/^[;|&]/.test(trimmed)) {
        return fail(BASH_SECURITY_CHECK_IDS.INCOMPLETE_COMMAND, "starts with operator");
    }
    if (trimmed.startsWith("-")) {
        return fail(BASH_SECURITY_CHECK_IDS.INCOMPLETE_COMMAND, "starts with parameters only");
    }
    return null;
}

function checkTokenInjection(ctx) {
    let single = 0;
    let dbl = 0;
    for (const ch of ctx.originalCommand) {
        if (ch === "'") single++;
        if (ch === '"') dbl++;
    }
    if (single % 2 !== 0 || dbl % 2 !== 0) {
        return fail(
            BASH_SECURITY_CHECK_IDS.TOKEN_INJECTION,
            "unbalanced quotes may split tokens incorrectly",
        );
    }
    return null;
}

function checkUnicodeWhitespace(ctx) {
    if (UNICODE_WS_RE.test(ctx.originalCommand)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.UNICODE_WHITESPACE,
            "Unicode whitespace can cause parsing inconsistencies",
        );
    }
    return null;
}

function checkPowerShellDangerousCommands(ctx) {
    const base = ctx.baseCommand.toLowerCase();
    if (PS_DANGEROUS_COMMANDS.has(base)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.ZSH_DANGEROUS_COMMANDS,
            `PowerShell command '${ctx.baseCommand}' can bypass safety checks`,
        );
    }
    if (/-encodedcommand\b/i.test(ctx.originalCommand)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
            "EncodedCommand hides script content",
        );
    }
    if (/\[Convert\]::FromBase64String/i.test(ctx.originalCommand)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
            "Base64 decoding can hide malicious payloads",
        );
    }
    return null;
}

function checkCommandSubstitution(ctx) {
    if (/\$\(|Invoke-Expression|\biex\b/i.test(ctx.originalCommand)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.COMMAND_SUBSTITUTION,
            "subexpression or Invoke-Expression can run arbitrary code",
        );
    }
    if (/\$\{[^}]+\}/.test(ctx.originalCommand)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.COMMAND_SUBSTITUTION,
            "${} subexpression may execute nested commands",
        );
    }
    return null;
}

function checkBraceExpansion(ctx) {
    if (/@[{(]/.test(ctx.originalCommand) && /\$[{(]/.test(ctx.originalCommand)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.BRACE_EXPANSION,
            "scriptblock or hashtable syntax may alter execution",
        );
    }
    return null;
}

function checkIoRedirection(ctx) {
    if (/>\s*[\w$~\\/]/.test(ctx.originalCommand) || /\d>>/.test(ctx.originalCommand)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.IO_REDIRECTION,
            "output redirection may write arbitrary files",
        );
    }
    if (/<\s*[\w$~\\/]/.test(ctx.originalCommand)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.IO_REDIRECTION,
            "input redirection may read arbitrary files",
        );
    }
    return null;
}

function checkIfsInjection(ctx) {
    if (/\$OFS\s*=|\-split\b/i.test(ctx.originalCommand) && /\$env:/i.test(ctx.originalCommand)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.IFS_INJECTION,
            "field separator manipulation with environment access",
        );
    }
    return null;
}

function checkProcAccess(ctx) {
    if (/\\proc\\|HKLM:|HKCU:|\\\\[^\\]+\\[^\\]+\\/i.test(ctx.originalCommand)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.PROC_ACCESS,
            "sensitive registry or UNC paths",
        );
    }
    return null;
}

function checkDangerousVariables(ctx) {
    if (/\$\w+\s*[|<>]|[|<>]\s*\$\w+/.test(ctx.originalCommand)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.DANGEROUS_VARIABLES,
            "variables adjacent to pipes or redirections",
        );
    }
    return null;
}

function checkShellMetacharacters(ctx) {
    if (/["'][^"']*[;|&][^"']*["']/.test(ctx.originalCommand)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.SHELL_METACHARACTERS,
            "shell metacharacters inside quoted arguments",
        );
    }
    return null;
}

function checkHashComment(ctx) {
    if (/#.*[;|&]/.test(ctx.originalCommand)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.HASH_COMMENT,
            "comment syntax adjacent to command chaining",
        );
    }
    return null;
}

function checkObfuscatedFlags(ctx) {
    if (/-\w+["'][^"']+["']/.test(ctx.originalCommand)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
            "quoted characters inside parameter names",
        );
    }
    return null;
}

function checkBacktickEscapedOperators(ctx) {
    for (let i = 0; i < ctx.originalCommand.length - 1; i++) {
        if (ctx.originalCommand[i] === "`" && PS_OPERATORS.has(ctx.originalCommand[i + 1])) {
            return fail(
                BASH_SECURITY_CHECK_IDS.BACKSLASH_ESCAPED_OPERATORS,
                "backtick before operator can hide command structure in PowerShell",
            );
        }
    }
    return null;
}

function checkJqSystem(ctx) {
    if (ctx.baseCommand.toLowerCase() === "jq" && /\bsystem\s*\(/.test(ctx.originalCommand)) {
        return fail(BASH_SECURITY_CHECK_IDS.JQ_SYSTEM, "jq system() executes arbitrary commands");
    }
    return null;
}

function checkJqFileArguments(ctx) {
    if (ctx.baseCommand.toLowerCase() !== "jq") return null;
    const afterJq = ctx.originalCommand.substring(ctx.baseCommand.length).trim();
    if (
        /(?:^|\s)(?:-f\b|--from-file|--rawfile|--slurpfile|-L\b|--library-path)/.test(
            afterJq,
        )
    ) {
        return fail(
            BASH_SECURITY_CHECK_IDS.JQ_FILE_ARGUMENTS,
            "jq flags that read arbitrary files or libraries",
        );
    }
    return null;
}

function checkGitCommitSubstitution(ctx) {
    const { originalCommand, baseCommand } = ctx;
    if (baseCommand.toLowerCase() !== "git" || !/^git\s+commit\s+/i.test(originalCommand)) {
        return null;
    }
    if (/\-m\s+["'][^"']*(\$\(|`)/i.test(originalCommand)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.GIT_COMMIT_SUBSTITUTION,
            "commit message contains command substitution",
        );
    }
    return null;
}

const POWERSHELL_SECURITY_CHECKS = [
    checkControlCharacters,
    checkBacktickEscapedWhitespace,
    checkEmbeddedNewline,
    checkIncompleteCommand,
    checkTokenInjection,
    checkUnicodeWhitespace,
    checkPowerShellDangerousCommands,
    checkJqSystem,
    checkJqFileArguments,
    checkGitCommitSubstitution,
    checkCommandSubstitution,
    checkBraceExpansion,
    checkIoRedirection,
    checkIfsInjection,
    checkProcAccess,
    checkDangerousVariables,
    checkShellMetacharacters,
    checkHashComment,
    checkObfuscatedFlags,
    checkBacktickEscapedOperators,
];

/**
 * @param {string} command
 * @returns {{ ok: true } | { ok: false, checkId: string, label: string, message: string }}
 */
export function scanPowerShellSecurity(command) {
    const trimmed = String(command ?? "").trim();
    if (!trimmed) return { ok: true };
    const ctx = buildContext(trimmed);
    for (const check of POWERSHELL_SECURITY_CHECKS) {
        const result = check(ctx);
        if (result) return result;
    }
    return { ok: true };
}
