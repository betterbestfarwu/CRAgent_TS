import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    COMPLETED_TODO_HIDE_MS,
    filterVisibleTodoRuns,
    msUntilTodoRunsHide,
} from "@shared/todoRunsDisplay.js";

describe("filterVisibleTodoRuns", () => {
    it("hides todo lists that have been all-completed for 5s", () => {
        const now = Date.now();
        const visible = filterVisibleTodoRuns(
            {
                run1: {
                    todos: [{ id: "1", content: "Done", status: "completed" }],
                    updatedAt: new Date(now - COMPLETED_TODO_HIDE_MS - 100).toISOString(),
                },
                run2: {
                    todos: [{ id: "2", content: "Working", status: "in_progress" }],
                    updatedAt: new Date(now).toISOString(),
                },
            },
            now,
        );
        assert.equal(Object.keys(visible).length, 1);
        assert.ok(visible.run2);
    });
});

describe("msUntilTodoRunsHide", () => {
    it("returns delay until the next hide", () => {
        const now = Date.now();
        const delay = msUntilTodoRunsHide(
            {
                run1: {
                    todos: [{ id: "1", content: "Done", status: "completed" }],
                    updatedAt: new Date(now - 1000).toISOString(),
                },
            },
            now,
        );
        assert.ok(delay !== null && delay > 0 && delay < COMPLETED_TODO_HIDE_MS);
    });
});
