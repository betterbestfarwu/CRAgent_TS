import test from "node:test";
import assert from "node:assert/strict";
import { scanPowerShellSecurity } from "../src/main/powershellSecurityChecks.js";
import { BASH_SECURITY_CHECK_IDS } from "../src/main/bashSecurityChecks.js";

test("blocks Invoke-Expression", () => {
    const r = scanPowerShellSecurity("Invoke-Expression 'Get-Process'");
    assert.equal(r.ok, false);
    assert.equal(r.checkId, BASH_SECURITY_CHECK_IDS.ZSH_DANGEROUS_COMMANDS);
});

test("blocks EncodedCommand", () => {
    const r = scanPowerShellSecurity("powershell -EncodedCommand YQBrAG0A");
    assert.equal(r.ok, false);
    assert.equal(r.checkId, BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS);
});

test("allows simple Get-ChildItem", () => {
    const r = scanPowerShellSecurity("Get-ChildItem .");
    assert.equal(r.ok, true);
});
