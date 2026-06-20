import test from "node:test";
import assert from "node:assert/strict";
import {
    titleFromAssistantReply,
    pickPlaceholderSession,
    titleFromFirstUserMessage,
} from "../src/shared/sessionTitle.js";

test("titleFromFirstUserMessage keeps short shell command", () => {
    assert.equal(titleFromFirstUserMessage("ls"), "ls");
});

test("titleFromFirstUserMessage trims and clips to 40 chars", () => {
    assert.equal(
        titleFromFirstUserMessage("   hello world   "),
        "hello world",
    );
    assert.equal(
        titleFromFirstUserMessage("x".repeat(80)),
        "x".repeat(40),
    );
});

test("titleFromFirstUserMessage returns null for empty input", () => {
    assert.equal(titleFromFirstUserMessage("   "), null);
});

test("titleFromAssistantReply uses the first reply sentence", () => {
    assert.equal(
        titleFromAssistantReply("可以的。下面是分析内容。\n\n第二段"),
        "可以的",
    );
});

test("pickPlaceholderSession ignores default-title sessions with user messages", () => {
    const picked = pickPlaceholderSession([
        {
            meta: { id: "with-user", title: "新会话", updatedAt: "2026-06-01T10:00:00.000Z" },
            messages: [{ role: "user", content: "ls" }],
        },
    ]);
    assert.equal(picked, null);
});

test("pickPlaceholderSession uses meta.hasUserMessages without loading messages", () => {
    const picked = pickPlaceholderSession([
        {
            meta: {
                id: "with-user",
                title: "新会话",
                updatedAt: "2026-06-01T10:00:00.000Z",
                hasUserMessages: true,
            },
            messages: [],
        },
        {
            meta: {
                id: "empty",
                title: "新会话",
                updatedAt: "2026-06-01T11:00:00.000Z",
                hasUserMessages: false,
            },
            messages: [],
        },
    ]);
    assert.equal(picked?.meta?.id, "empty");
});

test("pickPlaceholderSession picks newest empty default-title session", () => {
    const picked = pickPlaceholderSession([
        {
            meta: { id: "older", title: "新会话", updatedAt: "2026-06-01T09:00:00.000Z" },
            messages: [],
        },
        {
            meta: { id: "newer", title: "新会话", updatedAt: "2026-06-01T10:00:00.000Z" },
            messages: [],
        },
        {
            meta: { id: "custom", title: "debug", updatedAt: "2026-06-01T11:00:00.000Z" },
            messages: [],
        },
    ]);
    assert.equal(picked?.meta?.id, "newer");
});
