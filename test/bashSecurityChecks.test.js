import test from "node:test";
import assert from "node:assert/strict";
import {
    BASH_SECURITY_CHECK_IDS,
    listBashSecurityCheckIds,
    scanBashSecurity,
} from "../src/main/bashSecurityChecks.js";
import { classifyBashCommand } from "../src/main/bashSafety.js";
import { resolveShellRuntime } from "../src/main/shellRuntime.js";

test("lists exactly 20 security check ids", () => {
    assert.equal(listBashSecurityCheckIds().length, 20);
});

test("allows common safe commands", () => {
    const runtime = resolveShellRuntime(process.platform === "win32" ? "darwin" : process.platform);
    for (const cmd of ["echo hello", "git status", "ls -la", "pwd"]) {
        assert.equal(scanBashSecurity(cmd, { shellKind: runtime.kind }).ok, true, cmd);
        assert.equal(classifyBashCommand(cmd, runtime).kind, "allowed", cmd);
    }
    assert.equal(scanBashSecurity("npm test", { shellKind: runtime.kind }).ok, true);
    assert.equal(classifyBashCommand("npm test", runtime).kind, "needsConfirmation");
});

test("control characters", () => {
    const r = scanBashSecurity("echo safe\x00; rm -rf /");
    assert.equal(r.ok, false);
    assert.equal(r.checkId, BASH_SECURITY_CHECK_IDS.CONTROL_CHARACTERS);
});

test("embedded newline", () => {
    const r = scanBashSecurity("echo a\necho b");
    assert.equal(r.ok, false);
    assert.equal(r.checkId, BASH_SECURITY_CHECK_IDS.EMBEDDED_NEWLINE);
});

test("incomplete command", () => {
    const r = scanBashSecurity("&& echo hi");
    assert.equal(r.ok, false);
    assert.equal(r.checkId, BASH_SECURITY_CHECK_IDS.INCOMPLETE_COMMAND);
});

test("brace expansion", () => {
    const r = scanBashSecurity("echo {a,b}");
    assert.equal(r.ok, false);
    assert.equal(r.checkId, BASH_SECURITY_CHECK_IDS.BRACE_EXPANSION);
});

test("command substitution", () => {
    const r = scanBashSecurity("echo $(whoami)");
    assert.equal(r.ok, false);
    assert.equal(r.checkId, BASH_SECURITY_CHECK_IDS.COMMAND_SUBSTITUTION);
});

test("jq system()", () => {
    const r = scanBashSecurity('jq -n \'system("id")\'');
    assert.equal(r.ok, false);
    assert.equal(r.checkId, BASH_SECURITY_CHECK_IDS.JQ_SYSTEM);
});

test("io redirection", () => {
    const r = scanBashSecurity("echo secret > ~/.bashrc");
    assert.equal(r.ok, false);
    assert.equal(r.checkId, BASH_SECURITY_CHECK_IDS.IO_REDIRECTION);
});

test("jq file arguments", () => {
    const r = scanBashSecurity("jq -f /tmp/evil.jq");
    assert.equal(r.ok, false);
    assert.equal(r.checkId, BASH_SECURITY_CHECK_IDS.JQ_FILE_ARGUMENTS);
});

test("ifs injection", () => {
    const r = scanBashSecurity("IFS=,; cat /etc/passwd");
    assert.equal(r.ok, false);
    assert.equal(r.checkId, BASH_SECURITY_CHECK_IDS.IFS_INJECTION);
});

test("unicode whitespace", () => {
    const r = scanBashSecurity("echo\u00A0hi");
    assert.equal(r.ok, false);
    assert.equal(r.checkId, BASH_SECURITY_CHECK_IDS.UNICODE_WHITESPACE);
});

test("obfuscated flags", () => {
    const r = scanBashSecurity('cmd -x"hidden"');
    assert.equal(r.ok, false);
    assert.equal(r.checkId, BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS);
});

test("git commit substitution in double-quoted message", () => {
    const r = scanBashSecurity('git commit -m "$(whoami)"');
    assert.equal(r.ok, false);
    assert.equal(r.checkId, BASH_SECURITY_CHECK_IDS.GIT_COMMIT_SUBSTITUTION);
});

test("hash comment mid-word", () => {
    const r = scanBashSecurity("echo foo#bar");
    assert.equal(r.ok, false);
    assert.equal(r.checkId, BASH_SECURITY_CHECK_IDS.HASH_COMMENT);
});

test("shell metacharacters in quoted find -name", () => {
    const r = scanBashSecurity('find . -name "*.js;rm"');
    assert.equal(r.ok, false);
    assert.equal(r.checkId, BASH_SECURITY_CHECK_IDS.SHELL_METACHARACTERS);
});

test("zsh dangerous commands", () => {
    const r = scanBashSecurity("zmodload zsh/mapfile");
    assert.equal(r.ok, false);
    assert.equal(r.checkId, BASH_SECURITY_CHECK_IDS.ZSH_DANGEROUS_COMMANDS);
});

test("proc access", () => {
    const r = scanBashSecurity("cat /proc/self/environ", {
        shellKind: "bash",
        platform: "linux",
    });
    assert.equal(r.ok, false);
    assert.equal(r.checkId, BASH_SECURITY_CHECK_IDS.PROC_ACCESS);
});

test("dangerous variables", () => {
    const r = scanBashSecurity("echo x | $PATH");
    assert.equal(r.ok, false);
    assert.equal(r.checkId, BASH_SECURITY_CHECK_IDS.DANGEROUS_VARIABLES);
});

test("token injection unbalanced quotes", () => {
    const r = scanBashSecurity("echo 'unclosed");
    assert.equal(r.ok, false);
    assert.equal(r.checkId, BASH_SECURITY_CHECK_IDS.TOKEN_INJECTION);
});

test("backslash escaped whitespace", () => {
    const r = scanBashSecurity("echo hi\\ world");
    assert.equal(r.ok, false);
    assert.equal(r.checkId, BASH_SECURITY_CHECK_IDS.BACKSLASH_ESCAPED_WHITESPACE);
});

test("backslash escaped operators", () => {
    const r = scanBashSecurity("echo ok \\; rm -rf /");
    assert.equal(r.ok, false);
    assert.equal(r.checkId, BASH_SECURITY_CHECK_IDS.BACKSLASH_ESCAPED_OPERATORS);
});

test("classifyBashCommand surfaces security as needsConfirmation", () => {
    const runtime = resolveShellRuntime("darwin");
    const r = classifyBashCommand("echo $(id)", runtime);
    assert.equal(r.kind, "needsConfirmation");
    assert.equal(r.securityCheckId, BASH_SECURITY_CHECK_IDS.COMMAND_SUBSTITUTION);
});

test("classifyBashCommand still blocks destructive commands after security pass", () => {
    const runtime = resolveShellRuntime("darwin");
    const r = classifyBashCommand("rm -rf ./build", runtime);
    assert.equal(r.kind, "blocked");
});
