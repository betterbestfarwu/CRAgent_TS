import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    hookMatcherMatches,
    mergeHooksConfigs,
    normalizeHookEvent,
    parseHooksFileJson,
} from "../src/shared/hooksConfig.js";

describe("hooksConfig", () => {
    it("normalizes Cursor camelCase event names", () => {
        assert.equal(normalizeHookEvent("preToolUse"), "PreToolUse");
        assert.equal(normalizeHookEvent("beforeSubmitPrompt"), "UserPromptSubmit");
    });

    it("parses hooks.json shape", () => {
        const config = parseHooksFileJson({
            version: 1,
            hooks: {
                preToolUse: [{ command: "hooks/block.sh" }],
            },
        });
        assert.equal(config.hooks.PreToolUse.length, 1);
        assert.equal(config.hooks.PreToolUse[0].command, "hooks/block.sh");
    });

    it("merges user and project hook lists", () => {
        const merged = mergeHooksConfigs(
            { hooks: { PreToolUse: [{ command: "a.sh" }] } },
            { hooks: { PreToolUse: [{ command: "b.sh" }] } },
        );
        assert.equal(merged.hooks.PreToolUse.length, 2);
    });

    it("matches tool names with regex matchers", () => {
        assert.equal(hookMatcherMatches("bash", "bash"), true);
        assert.equal(hookMatcherMatches("^bash$", "bash"), true);
        assert.equal(hookMatcherMatches("^bash$", "read_file"), false);
    });
});
