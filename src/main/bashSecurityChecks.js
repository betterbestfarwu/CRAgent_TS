/**
 * Bash command security scanner (20 checks, aligned with Cursor BashTool).
 * Regex/quote-aware path — no tree-sitter dependency.
 */

export const BASH_SECURITY_CHECK_IDS = {
    BACKSLASH_ESCAPED_WHITESPACE: "backslash_whitespace",
    EMBEDDED_NEWLINE: "embedded_newline",
    INCOMPLETE_COMMAND: "incomplete_command",
    BRACE_EXPANSION: "brace_expansion",
    COMMAND_SUBSTITUTION: "command_substitution",
    JQ_SYSTEM: "jq_system",
    IO_REDIRECTION: "io_redirection",
    CONTROL_CHARACTERS: "control_characters",
    JQ_FILE_ARGUMENTS: "jq_file_arguments",
    IFS_INJECTION: "ifs_injection",
    UNICODE_WHITESPACE: "unicode_whitespace",
    OBFUSCATED_FLAGS: "obfuscated_flags",
    GIT_COMMIT_SUBSTITUTION: "git_commit_substitution",
    HASH_COMMENT: "hash_comment",
    SHELL_METACHARACTERS: "shell_metacharacters",
    ZSH_DANGEROUS_COMMANDS: "zsh_dangerous_commands",
    PROC_ACCESS: "proc_access",
    DANGEROUS_VARIABLES: "dangerous_variables",
    TOKEN_INJECTION: "token_injection",
    BACKSLASH_ESCAPED_OPERATORS: "backslash_escaped_operators",
};

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

const ZSH_DANGEROUS_COMMANDS = new Set([
    "zmodload",
    "emulate",
    "sysopen",
    "sysread",
    "syswrite",
    "sysseek",
    "zpty",
    "ztcp",
    "zsocket",
    "zf_rm",
    "zf_mv",
    "zf_ln",
    "zf_chmod",
    "zf_chown",
    "zf_mkdir",
    "zf_rmdir",
    "zf_chgrp",
]);

const COMMAND_SUBSTITUTION_PATTERNS = [
    { pattern: /<\(/, message: "process substitution <()" },
    { pattern: />\(/, message: "process substitution >()" },
    { pattern: /=\(/, message: "Zsh process substitution =()" },
    {
        pattern: /(?:^|[\s;&|])=[a-zA-Z_]/,
        message: "Zsh equals expansion (=cmd)",
    },
    { pattern: /\$\(/, message: "$() command substitution" },
    { pattern: /\$\{/, message: "${} parameter substitution" },
    { pattern: /\$\[/, message: "$[] legacy arithmetic expansion" },
    { pattern: /~\[/, message: "Zsh-style parameter expansion" },
    { pattern: /\(e:/, message: "Zsh-style glob qualifiers" },
    { pattern: /\(\+/, message: "Zsh glob qualifier with command execution" },
    {
        pattern: /\}\s*always\s*\{/,
        message: "Zsh always block (try/always construct)",
    },
];

const SHELL_OPERATORS = new Set([";", "|", "&", "<", ">"]);

// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

const UNICODE_WS_RE =
    /[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]/;

const ZSH_PRECOMMAND_MODIFIERS = new Set(["command", "builtin", "noglob", "nocorrect"]);

function fail(checkId, message) {
    const label = CHECK_LABELS[checkId] || checkId;
    return { ok: false, checkId, label, message: `${label}: ${message}` };
}

function extractQuotedContent(command, isJq = false) {
    let withDoubleQuotes = "";
    let fullyUnquoted = "";
    let unquotedKeepQuoteChars = "";
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let escaped = false;

    for (let i = 0; i < command.length; i++) {
        const char = command[i];

        if (escaped) {
            escaped = false;
            if (!inSingleQuote) withDoubleQuotes += char;
            if (!inSingleQuote && !inDoubleQuote) fullyUnquoted += char;
            if (!inSingleQuote && !inDoubleQuote) unquotedKeepQuoteChars += char;
            continue;
        }

        if (char === "\\" && !inSingleQuote) {
            escaped = true;
            if (!inSingleQuote) withDoubleQuotes += char;
            if (!inSingleQuote && !inDoubleQuote) fullyUnquoted += char;
            if (!inSingleQuote && !inDoubleQuote) unquotedKeepQuoteChars += char;
            continue;
        }

        if (char === "'" && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote;
            unquotedKeepQuoteChars += char;
            continue;
        }

        if (char === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote;
            unquotedKeepQuoteChars += char;
            if (!isJq) continue;
        }

        if (!inSingleQuote) withDoubleQuotes += char;
        if (!inSingleQuote && !inDoubleQuote) fullyUnquoted += char;
        if (!inSingleQuote && !inDoubleQuote) unquotedKeepQuoteChars += char;
    }

    return { withDoubleQuotes, fullyUnquoted, unquotedKeepQuoteChars };
}

function stripSafeRedirections(content) {
    return content
        .replace(/\s+2\s*>&\s*1(?=\s|$)/g, "")
        .replace(/[012]?\s*>\s*\/dev\/null(?=\s|$)/g, "")
        .replace(/\s*<\s*\/dev\/null(?=\s|$)/g, "");
}

function hasUnescapedChar(content, char) {
    let i = 0;
    while (i < content.length) {
        if (content[i] === "\\" && i + 1 < content.length) {
            i += 2;
            continue;
        }
        if (content[i] === char) return true;
        i++;
    }
    return false;
}

function isEscapedAtPosition(content, pos) {
    let backslashCount = 0;
    let i = pos - 1;
    while (i >= 0 && content[i] === "\\") {
        backslashCount++;
        i--;
    }
    return backslashCount % 2 === 1;
}

function extractBaseCommand(command) {
    const tokens = command.trim().split(/\s+/);
    for (const token of tokens) {
        if (/^[A-Za-z_]\w*=/.test(token)) continue;
        if (ZSH_PRECOMMAND_MODIFIERS.has(token)) continue;
        return token;
    }
    return "";
}

function buildContext(command) {
    const { fullyUnquoted, unquotedKeepQuoteChars } = extractQuotedContent(command);
    const fullyUnquotedPreStrip = fullyUnquoted;
    const fullyUnquotedContent = stripSafeRedirections(fullyUnquoted);
    const jqExtract = extractQuotedContent(command, true);
    return {
        originalCommand: command,
        baseCommand: extractBaseCommand(command),
        unquotedContent: jqExtract.withDoubleQuotes,
        fullyUnquotedContent,
        fullyUnquotedPreStrip,
        unquotedKeepQuoteChars,
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

function checkEmbeddedNewline(ctx) {
    const content = ctx.fullyUnquotedPreStrip;
    if (!/[\n\r]/.test(content)) return null;

    for (let i = 0; i < content.length; i++) {
        const ch = content[i];
        if (ch !== "\n" && ch !== "\r") continue;
        const prev = i > 0 ? content[i - 1] : "";
        if (prev === "\\") continue;
        const next = content[i + 1];
        if (next && !/[\s]/.test(next)) {
            return fail(
                BASH_SECURITY_CHECK_IDS.EMBEDDED_NEWLINE,
                "command contains embedded newline that may run additional commands",
            );
        }
    }
    return null;
}

function checkIncompleteCommand(ctx) {
    const { originalCommand } = ctx;
    const trimmed = originalCommand.trim();

    if (/^\s*\t/.test(originalCommand)) {
        return fail(BASH_SECURITY_CHECK_IDS.INCOMPLETE_COMMAND, "starts with tab");
    }
    if (trimmed.startsWith("-")) {
        return fail(BASH_SECURITY_CHECK_IDS.INCOMPLETE_COMMAND, "starts with flags only");
    }
    if (/^\s*(&&|\|\||;|>>?|<)/.test(originalCommand)) {
        return fail(BASH_SECURITY_CHECK_IDS.INCOMPLETE_COMMAND, "starts with shell operator");
    }
    return null;
}

function checkBraceExpansion(ctx) {
    const content = ctx.fullyUnquotedPreStrip;
    let unescapedOpenBraces = 0;
    let unescapedCloseBraces = 0;
    for (let i = 0; i < content.length; i++) {
        if (content[i] === "{" && !isEscapedAtPosition(content, i)) unescapedOpenBraces++;
        else if (content[i] === "}" && !isEscapedAtPosition(content, i)) unescapedCloseBraces++;
    }
    if (unescapedOpenBraces > 0 && unescapedCloseBraces > unescapedOpenBraces) {
        return fail(
            BASH_SECURITY_CHECK_IDS.BRACE_EXPANSION,
            "excess closing braces after quote stripping (brace expansion obfuscation)",
        );
    }
    if (unescapedOpenBraces > 0 && /['"][{}]['"]/.test(ctx.originalCommand)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.BRACE_EXPANSION,
            "quoted brace inside brace context",
        );
    }

    for (let i = 0; i < content.length; i++) {
        if (content[i] !== "{" || isEscapedAtPosition(content, i)) continue;
        let depth = 1;
        let matchingClose = -1;
        for (let j = i + 1; j < content.length; j++) {
            const ch = content[j];
            if (ch === "{" && !isEscapedAtPosition(content, j)) depth++;
            else if (ch === "}" && !isEscapedAtPosition(content, j)) {
                depth--;
                if (depth === 0) {
                    matchingClose = j;
                    break;
                }
            }
        }
        if (matchingClose === -1) continue;
        let innerDepth = 0;
        for (let k = i + 1; k < matchingClose; k++) {
            const ch = content[k];
            if (ch === "{" && !isEscapedAtPosition(content, k)) innerDepth++;
            else if (ch === "}" && !isEscapedAtPosition(content, k)) innerDepth--;
            else if (innerDepth === 0) {
                if (
                    ch === "," ||
                    (ch === "." && k + 1 < matchingClose && content[k + 1] === ".")
                ) {
                    return fail(
                        BASH_SECURITY_CHECK_IDS.BRACE_EXPANSION,
                        "brace expansion may alter command parsing",
                    );
                }
            }
        }
    }
    return null;
}

function posixSubstitutionPatterns(shellKind) {
    if (shellKind === "zsh") return COMMAND_SUBSTITUTION_PATTERNS;
    return COMMAND_SUBSTITUTION_PATTERNS.filter(
        ({ message }) =>
            !message.includes("Zsh") && !message.includes("process substitution =()"),
    );
}

function checkCommandSubstitution(ctx, shellKind) {
    const { unquotedContent } = ctx;
    if (hasUnescapedChar(unquotedContent, "`")) {
        return fail(
            BASH_SECURITY_CHECK_IDS.COMMAND_SUBSTITUTION,
            "backticks (`) for command substitution",
        );
    }
    for (const { pattern, message } of posixSubstitutionPatterns(shellKind)) {
        if (pattern.test(unquotedContent)) {
            return fail(BASH_SECURITY_CHECK_IDS.COMMAND_SUBSTITUTION, message);
        }
    }
    return null;
}

function checkJqSystem(ctx) {
    if (ctx.baseCommand !== "jq") return null;
    if (/\bsystem\s*\(/.test(ctx.originalCommand)) {
        return fail(BASH_SECURITY_CHECK_IDS.JQ_SYSTEM, "jq system() executes arbitrary commands");
    }
    return null;
}

function checkJqFileArguments(ctx) {
    if (ctx.baseCommand !== "jq") return null;
    const afterJq = ctx.originalCommand.substring(3).trim();
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

function checkIoRedirection(ctx) {
    const content = ctx.fullyUnquotedContent;
    if (/>>?/.test(content)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.IO_REDIRECTION,
            "output redirection (>) may write arbitrary files",
        );
    }
    if (/(?<![<-])<(?![<-=])/.test(content)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.IO_REDIRECTION,
            "input redirection (<) may read arbitrary files",
        );
    }
    return null;
}

function checkIfsInjection(ctx) {
    if (/\bIFS\s*=/.test(ctx.originalCommand) || /\$IFS/.test(ctx.originalCommand)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.IFS_INJECTION,
            "IFS manipulation can change word splitting",
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

function checkObfuscatedFlags(ctx) {
    const { unquotedContent } = ctx;
    if (/(?:^|\s)-[^ \t\n\r]+["'][^"']*["']/.test(unquotedContent)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
            "quoted characters inside flag names",
        );
    }
    return null;
}

function checkGitCommitSubstitution(ctx) {
    const { originalCommand, baseCommand } = ctx;
    if (baseCommand !== "git" || !/^git\s+commit\s+/.test(originalCommand)) return null;
    if (originalCommand.includes("\\")) return null;

    const messageMatch = originalCommand.match(
        /^git[ \t]+commit[ \t]+[^;&|`$<>()\n\r]*?-m[ \t]+(["'])([\s\S]*?)\1(.*)$/,
    );
    if (!messageMatch) return null;

    const [, quote, messageContent, remainder] = messageMatch;
    if (quote === '"' && messageContent && /\$\(|`|\$\{/.test(messageContent)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.GIT_COMMIT_SUBSTITUTION,
            "commit message contains command substitution",
        );
    }
    if (remainder && /[;|&()`]|\$\(|\$\{/.test(remainder)) return null;
    if (messageContent && messageContent.startsWith("-")) {
        return fail(
            BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
            "commit message starts with dash",
        );
    }
    return null;
}

function checkHashComment(ctx) {
    const joined = ctx.unquotedKeepQuoteChars.replace(/\\+\n/g, (match) => {
        const backslashCount = match.length - 1;
        return backslashCount % 2 === 1 ? "\\".repeat(backslashCount - 1) : match;
    });
    if (/(?<!\$)\S#/.test(joined)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.HASH_COMMENT,
            "mid-word # can hide command structure from parsers",
        );
    }
    return null;
}

function checkShellMetacharacters(ctx) {
    const { unquotedContent } = ctx;
    const message = "shell metacharacters (;, |, or &) inside quoted arguments";
    if (/(?:^|\s)["'][^"']*[;&][^"']*["'](?:\s|$)/.test(unquotedContent)) {
        return fail(BASH_SECURITY_CHECK_IDS.SHELL_METACHARACTERS, message);
    }
    const globPatterns = [
        /-name\s+["'][^"']*[;|&][^"']*["']/,
        /-path\s+["'][^"']*[;|&][^"']*["']/,
        /-iname\s+["'][^"']*[;|&][^"']*["']/,
        /-regex\s+["'][^"']*[;&][^"']*["']/,
    ];
    if (globPatterns.some((p) => p.test(unquotedContent))) {
        return fail(BASH_SECURITY_CHECK_IDS.SHELL_METACHARACTERS, message);
    }
    return null;
}

function checkZshDangerousCommands(ctx, shellKind) {
    if (shellKind !== "zsh") return null;
    const trimmed = ctx.originalCommand.trim();
    if (ZSH_DANGEROUS_COMMANDS.has(ctx.baseCommand)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.ZSH_DANGEROUS_COMMANDS,
            `Zsh-specific '${ctx.baseCommand}' can bypass checks`,
        );
    }
    if (ctx.baseCommand === "fc" && /\s-\S*e/.test(trimmed)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.ZSH_DANGEROUS_COMMANDS,
            "fc -e can execute arbitrary commands via editor",
        );
    }
    return null;
}

function checkProcAccess(ctx, platform) {
    if (platform === "darwin") return null;
    if (/\/proc\/(?:self\/environ|[^/\s]+\/(?:environ|cmdline|fd\/))/i.test(ctx.originalCommand)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.PROC_ACCESS,
            "access to sensitive /proc paths",
        );
    }
    if (platform === "linux" && /\/proc\/[^/\s]+/i.test(ctx.fullyUnquotedPreStrip)) {
        return fail(BASH_SECURITY_CHECK_IDS.PROC_ACCESS, "access to /proc filesystem");
    }
    return null;
}

function checkDangerousVariables(ctx) {
    const content = ctx.fullyUnquotedContent;
    if (
        /[<>|]\s*\$[A-Za-z_]/.test(content) ||
        /\$[A-Za-z_][A-Za-z0-9_]*\s*[|<>]/.test(content)
    ) {
        return fail(
            BASH_SECURITY_CHECK_IDS.DANGEROUS_VARIABLES,
            "variables adjacent to redirections or pipes",
        );
    }
    return null;
}

function hasUnbalancedQuotes(command) {
    let inSingle = false;
    let inDouble = false;
    let escaped = false;
    for (let i = 0; i < command.length; i++) {
        const char = command[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === "\\" && !inSingle) {
            escaped = true;
            continue;
        }
        if (char === "'" && !inDouble) inSingle = !inSingle;
        else if (char === '"' && !inSingle) inDouble = !inDouble;
    }
    return inSingle || inDouble;
}

function checkTokenInjection(ctx) {
    if (hasUnbalancedQuotes(ctx.originalCommand)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.TOKEN_INJECTION,
            "unbalanced quotes may split tokens incorrectly",
        );
    }
    if (/\$\([^)]*$/.test(ctx.unquotedContent) || /`[^`]*$/.test(ctx.unquotedContent)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.TOKEN_INJECTION,
            "incomplete command substitution",
        );
    }
    return null;
}

function hasBackslashEscapedWhitespace(command) {
    let inSingleQuote = false;
    let inDoubleQuote = false;
    for (let i = 0; i < command.length; i++) {
        const char = command[i];
        if (char === "\\" && !inSingleQuote) {
            const next = command[i + 1];
            if (!inDoubleQuote && (next === " " || next === "\t")) {
                return true;
            }
            if (next) i++;
            continue;
        }
        if (char === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote;
        else if (char === '"' && !inSingleQuote) inDoubleQuote = !inDoubleQuote;
    }
    return false;
}

function checkBackslashEscapedWhitespace(ctx) {
    if (hasBackslashEscapedWhitespace(ctx.originalCommand)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.BACKSLASH_ESCAPED_WHITESPACE,
            "backslash before whitespace can hide command boundaries",
        );
    }
    return null;
}

function hasBackslashEscapedOperator(command) {
    let inSingleQuote = false;
    let inDoubleQuote = false;
    for (let i = 0; i < command.length; i++) {
        const char = command[i];
        if (char === "\\" && !inSingleQuote) {
            if (!inDoubleQuote) {
                const nextChar = command[i + 1];
                if (nextChar && SHELL_OPERATORS.has(nextChar)) return true;
            }
            i++;
            continue;
        }
        if (char === "'" && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote;
            continue;
        }
        if (char === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote;
            continue;
        }
    }
    return false;
}

function checkBackslashEscapedOperators(ctx) {
    if (hasBackslashEscapedOperator(ctx.originalCommand)) {
        return fail(
            BASH_SECURITY_CHECK_IDS.BACKSLASH_ESCAPED_OPERATORS,
            "backslash before shell operator (;, |, &, <, >) can hide structure",
        );
    }
    return null;
}

function buildSecurityChecks(shellKind, platform) {
    return [
        checkControlCharacters,
        checkBackslashEscapedWhitespace,
        checkEmbeddedNewline,
        checkIncompleteCommand,
        checkTokenInjection,
        checkUnicodeWhitespace,
        checkIfsInjection,
        (ctx) => checkProcAccess(ctx, platform),
        (ctx) => checkZshDangerousCommands(ctx, shellKind),
        checkJqSystem,
        checkJqFileArguments,
        checkGitCommitSubstitution,
        (ctx) => checkCommandSubstitution(ctx, shellKind),
        checkBraceExpansion,
        checkIoRedirection,
        checkDangerousVariables,
        checkShellMetacharacters,
        checkHashComment,
        checkObfuscatedFlags,
        checkBackslashEscapedOperators,
    ];
}

/**
 * Run all 20 posix shell security checks on a command string.
 * @param {string} command
 * @param {{ shellKind?: 'zsh' | 'bash', platform?: string }} [options]
 * @returns {{ ok: true } | { ok: false, checkId: string, label: string, message: string }}
 */
export function scanBashSecurity(command, options = {}) {
    const shellKind = options.shellKind === "bash" ? "bash" : "zsh";
    const platform = options.platform ?? process.platform;
    const trimmed = String(command ?? "").trim();
    if (!trimmed) {
        return { ok: true };
    }
    const ctx = buildContext(trimmed);
    for (const check of buildSecurityChecks(shellKind, platform)) {
        const result = check(ctx);
        if (result) return result;
    }
    return { ok: true };
}

export function listBashSecurityCheckIds() {
    return Object.values(BASH_SECURITY_CHECK_IDS);
}
