import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    buildConversationPreview,
    buildRulesPreview,
    buildSubagentDefinitionsPreview,
    buildToolDefinitionsPreview,
} from "../src/main/contextDetailPreviews.js";

test("buildConversationPreview includes summary and active messages", () => {
    const session = {
        meta: {
            llmContextFromIndex: 0,
            contextSummary: "User asked about auth.",
        },
        messages: [
            { role: "user", content: "hello" },
            { role: "assistant", content: "hi there" },
        ],
    };

    const preview = buildConversationPreview(session);

    assert.match(preview, /conversation_summary/);
    assert.match(preview, /User asked about auth/);
    assert.match(preview, /\[user\]/);
    assert.match(preview, /hello/);
    assert.match(preview, /\[assistant\]/);
});

test("buildRulesPreview reads AGENTS.md from workspace", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-rules-"));
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "# Rules\nBe careful.", "utf-8");

    const preview = buildRulesPreview(
        { meta: { todos: [{ id: "1", status: "pending", content: "task" }] } },
        dir,
    );

    assert.match(preview, /Be careful/);
    assert.match(preview, /active_todos/);
});

test("buildToolDefinitionsPreview formats enabled tool schemas", () => {
    const preview = buildToolDefinitionsPreview(
        {
            schemas: () => [
                {
                    function: {
                        name: "read_file",
                        description: "Read a file",
                        parameters: { type: "object", properties: { path: { type: "string" } } },
                    },
                },
            ],
        },
        { enable_tools: true },
    );

    assert.match(preview, /read_file/);
    assert.match(preview, /Read a file/);
});

test("buildSubagentDefinitionsPreview lists sub-agent prompts", () => {
    const preview = buildSubagentDefinitionsPreview({ allow_sub_agents: true });
    assert.match(preview, /sub-agent \(generalPurpose\)/);
    assert.match(preview, /sub-agent \(explore\)/);
});
