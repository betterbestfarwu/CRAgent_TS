import test from "node:test";
import assert from "node:assert/strict";
import {
    resolveShellRuntime,
    SHELL_KIND,
    describeShellInvocation,
} from "../src/main/shellRuntime.js";
import { classifyBashCommand } from "../src/main/bashSafety.js";
import { scanShellSecurity } from "../src/main/shellSecurity.js";
import { BASH_SECURITY_CHECK_IDS } from "../src/main/bashSecurityChecks.js";

test("resolveShellRuntime picks PowerShell on win32", () => {
    const runtime = resolveShellRuntime("win32");
    assert.equal(runtime.kind, SHELL_KIND.POWERSHELL);
    assert.match(runtime.executable.toLowerCase(), /powershell/);
    assert.deepEqual(runtime.argsPrefix.slice(-1), ["-Command"]);
});

test("resolveShellRuntime prefers zsh on darwin", () => {
    const runtime = resolveShellRuntime("darwin");
    assert.equal(runtime.kind, SHELL_KIND.ZSH);
    assert.equal(runtime.executable, "/bin/zsh");
});

test("describeShellInvocation includes executable", () => {
    const runtime = resolveShellRuntime("darwin");
    assert.match(describeShellInvocation(runtime), /\/bin\/zsh/);
});

test("scanShellSecurity routes to PowerShell checks", () => {
    const r = scanShellSecurity("Invoke-Expression 'whoami'", SHELL_KIND.POWERSHELL);
    assert.equal(r.ok, false);
    assert.equal(r.checkId, BASH_SECURITY_CHECK_IDS.ZSH_DANGEROUS_COMMANDS);
});

test("classifyBashCommand blocks Windows destructive patterns", () => {
    const runtime = resolveShellRuntime("win32");
    const r = classifyBashCommand("Write-Output before; format c: after", runtime);
    assert.equal(r.kind, "blocked");
});

test("classifyBashCommand flags PowerShell dangerous cmdlets", () => {
    const runtime = resolveShellRuntime("win32");
    const r = classifyBashCommand("Remove-Item -Recurse .\\build", runtime);
    assert.equal(r.kind, "needsConfirmation");
});

test("posix proc check skipped on darwin", () => {
    const r = scanShellSecurity("cat /proc/self/environ", SHELL_KIND.ZSH, { platform: "darwin" });
    assert.equal(r.ok, true);
});

test("posix proc check runs on linux", () => {
    const r = scanShellSecurity("cat /proc/self/environ", SHELL_KIND.BASH, { platform: "linux" });
    assert.equal(r.ok, false);
    assert.equal(r.checkId, BASH_SECURITY_CHECK_IDS.PROC_ACCESS);
});
