import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    GROUPABLE_TOOLS,
    buildThinkingSummary,
    collapseAdjacentThinkingItems,
    formatThinkingSummaryLine,
    getCurrentInProgressTodo,
    sortTodosForDisplay,
    todoDisplayLabel,
} from "@shared/chatUiUtils.js";

describe("buildThinkingSummary", () => {
    it("summarizes read and shell tool calls semantically", () => {
        const result = buildThinkingSummary([
            {
                id: "a1",
                role: "assistant",
                tool_calls: [
                    {
                        id: "c-read-1",
                        name: "read_file",
                        arguments: JSON.stringify({ path: "src/a.js" }),
                    },
                    {
                        id: "c-read-2",
                        name: "read_file",
                        arguments: JSON.stringify({ path: "src/b.js" }),
                    },
                    { id: "c-bash-1", name: "bash", arguments: JSON.stringify({ command: "npm test" }) },
                ],
            },
            { id: "t1", role: "tool", name: "read_file", tool_call_id: "c-read-1", content: "a" },
            { id: "t2", role: "tool", name: "read_file", tool_call_id: "c-read-2", content: "b" },
            { id: "t3", role: "tool", name: "bash", tool_call_id: "c-bash-1", content: "ok" },
        ]);

        assert.equal(result.stepCount, 4);
        assert.match(result.summaryLine, /Read 2 files/);
        assert.match(result.summaryLine, /Ran 1 command/);
        assert.match(result.summaryLine, /\(4 steps\)/);
        assert.equal(
            result.items.filter((item) => item.kind === "tool-call-group").length,
            1,
        );
        assert.equal(
            result.items.filter((item) => item.kind === "tool-result-group").length,
            1,
        );
    });

    it("groups consecutive same-tool calls in one assistant message", () => {
        const result = buildThinkingSummary([
            {
                id: "a1",
                role: "assistant",
                tool_calls: [
                    { id: "1", name: "read_file", arguments: '{"path":"a.ts"}' },
                    { id: "2", name: "read_file", arguments: '{"path":"b.ts"}' },
                    { id: "3", name: "read_file", arguments: '{"path":"c.ts"}' },
                ],
            },
        ]);

        assert.equal(result.items.length, 1);
        assert.equal(result.items[0].kind, "tool-call-group");
        assert.equal(result.items[0].calls.length, 3);
    });

    it("matches tool results to call groups by tool_call_id", () => {
        const result = buildThinkingSummary([
            {
                id: "a1",
                role: "assistant",
                tool_calls: [
                    { id: "1", name: "read_file", arguments: "{}" },
                    { id: "2", name: "read_file", arguments: "{}" },
                ],
            },
            { id: "t1", role: "tool", name: "read_file", tool_call_id: "1", content: "one" },
            { id: "t2", role: "tool", name: "read_file", tool_call_id: "2", content: "two" },
        ]);

        assert.equal(result.items.length, 2);
        assert.equal(result.items[0].kind, "tool-call-group");
        assert.equal(result.items[1].kind, "tool-result-group");
        assert.deepEqual(result.items[1].results, ["one", "two"]);
    });

    it("collapses same-tool groups across separate assistant messages", () => {
        const result = buildThinkingSummary([
            {
                id: "a1",
                role: "assistant",
                tool_calls: [
                    { id: "1", name: "read_file", arguments: "{}" },
                    { id: "2", name: "read_file", arguments: "{}" },
                ],
            },
            {
                id: "a2",
                role: "assistant",
                tool_calls: [
                    { id: "3", name: "read_file", arguments: "{}" },
                    { id: "4", name: "read_file", arguments: "{}" },
                ],
            },
        ]);

        assert.equal(result.items.length, 1);
        assert.equal(result.items[0].kind, "tool-call-group");
        assert.equal(result.items[0].calls.length, 4);
    });

    it("verbose mode keeps separate tool-call steps", () => {
        const result = buildThinkingSummary(
            [
                {
                    id: "a1",
                    role: "assistant",
                    tool_calls: [
                        { id: "1", name: "read_file", arguments: "{}" },
                        { id: "2", name: "read_file", arguments: "{}" },
                    ],
                },
            ],
            { verbose: true },
        );

        assert.equal(result.items.length, 2);
        assert.equal(result.items[0].kind, "tool-call");
        assert.equal(result.items[1].kind, "tool-call");
    });

    it("falls back to step count when no collapsible tools", () => {
        const result = buildThinkingSummary([
            {
                id: "a1",
                role: "assistant",
                tool_calls: [{ name: "TodoWrite", arguments: "{}" }],
            },
        ]);
        assert.equal(result.summaryLine, "Thinking · 1 other step (1 step)");
        assert.ok(!GROUPABLE_TOOLS.has("TodoWrite"));
    });
});

describe("collapseAdjacentThinkingItems", () => {
    it("merges neighboring tool-result groups", () => {
        const merged = collapseAdjacentThinkingItems(
            [
                { kind: "tool-result-group", name: "read_file", results: ["a"] },
                { kind: "tool-result-group", name: "read_file", results: ["b"] },
            ],
            false,
        );
        assert.equal(merged.length, 1);
        assert.deepEqual(merged[0].results, ["a", "b"]);
    });
});

describe("formatThinkingSummaryLine", () => {
    it("builds empty semantic line from zero stats", () => {
        assert.equal(
            formatThinkingSummaryLine(
                {
                    read: 0,
                    readPaths: new Set(),
                    list: 0,
                    search: 0,
                    shell: 0,
                    web: 0,
                    write: 0,
                    other: 0,
                    assistantText: 0,
                },
                0,
            ),
            "Thinking · 0 steps",
        );
    });
});

describe("todo display helpers", () => {
    it("sorts in_progress before pending before completed", () => {
        const sorted = sortTodosForDisplay([
            { id: "3", content: "Done", status: "completed" },
            { id: "1", content: "Next", status: "pending" },
            { id: "2", content: "Now", status: "in_progress" },
        ]);
        assert.deepEqual(
            sorted.map((item) => item.status),
            ["in_progress", "pending", "completed"],
        );
    });

    it("uses activeForm for in_progress label", () => {
        assert.equal(
            todoDisplayLabel({
                id: "1",
                content: "Run tests",
                activeForm: "Running tests",
                status: "in_progress",
            }),
            "Running tests",
        );
        assert.equal(
            todoDisplayLabel({ id: "1", content: "Run tests", status: "pending" }),
            "Run tests",
        );
    });

    it("finds current in_progress todo", () => {
        const current = getCurrentInProgressTodo([
            { id: "1", content: "A", status: "pending" },
            { id: "2", content: "B", activeForm: "Building", status: "in_progress" },
        ]);
        assert.equal(current?.id, "2");
    });
});
