import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    buildThinkingSummary,
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
                        name: "read_file",
                        arguments: JSON.stringify({ path: "src/a.js" }),
                    },
                    {
                        name: "read_file",
                        arguments: JSON.stringify({ path: "src/b.js" }),
                    },
                    { name: "bash", arguments: JSON.stringify({ command: "npm test" }) },
                ],
            },
            { id: "t1", role: "tool", name: "read_file", content: "ok" },
        ]);

        assert.equal(result.stepCount, 4);
        assert.match(result.summaryLine, /Read 2 files/);
        assert.match(result.summaryLine, /Ran 1 command/);
        assert.match(result.summaryLine, /\(4 steps\)/);
        assert.equal(result.items.length, 4);
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
