import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildComputerUsePrompt,
    filterSlashCommands,
    isActiveManualSlashCommand,
    isSlashKey,
    matchChatCommand,
    parseActiveSlashCommand,
    parseComputerUseInvocation,
} from "../src/shared/chatCommands.js";

describe("parseActiveSlashCommand", () => {
    it("detects slash at start of input", () => {
        assert.deepEqual(parseActiveSlashCommand("/help"), {
            query: "help",
            slashStart: 0,
            slashEnd: 5,
        });
    });

    it("detects trailing slash after other text", () => {
        assert.deepEqual(parseActiveSlashCommand("hello /he"), {
            query: "he",
            slashStart: 6,
            slashEnd: 9,
        });
    });

    it("detects slash after a space", () => {
        assert.deepEqual(parseActiveSlashCommand(" /"), {
            query: "",
            slashStart: 1,
            slashEnd: 2,
        });
    });

    it("detects trailing slash directly after other text", () => {
        assert.deepEqual(parseActiveSlashCommand("hello/he"), {
            query: "he",
            slashStart: 5,
            slashEnd: 8,
        });
    });

    it("detects slash immediately after text", () => {
        assert.deepEqual(parseActiveSlashCommand("hello/"), {
            query: "",
            slashStart: 5,
            slashEnd: 6,
        });
    });

    it("returns null when slash is not active at end", () => {
        assert.equal(parseActiveSlashCommand("/help more"), null);
    });

    it("does not open menu for pasted URL paths without manual slash input", () => {
        const parsed = parseActiveSlashCommand("https://www.googleapis.com/customsearch/v1");
        assert.equal(parsed?.query, "v1");
        assert.equal(isActiveManualSlashCommand(parsed, null), false);

        const path = parseActiveSlashCommand("https://example.com/foo/bar");
        assert.equal(path?.query, "bar");
        assert.equal(isActiveManualSlashCommand(path, null), false);
    });
});

describe("manual slash command gating", () => {
    it("detects slash key presses", () => {
        assert.equal(isSlashKey({ key: "/" }), true);
        assert.equal(isSlashKey({ key: "?" }), false);
        assert.equal(isSlashKey({ key: "/", ctrlKey: true }), false);
    });

    it("only opens menu for manually typed slash positions", () => {
        const spaced = parseActiveSlashCommand("hello /help");
        assert.equal(isActiveManualSlashCommand(spaced, 6), true);
        assert.equal(isActiveManualSlashCommand(spaced, null), false);
        assert.equal(isActiveManualSlashCommand(spaced, 5), false);

        const direct = parseActiveSlashCommand("hello/help");
        assert.equal(isActiveManualSlashCommand(direct, 5), true);
        assert.equal(isActiveManualSlashCommand(direct, null), false);
    });
});

describe("chatCommands computer use", () => {
    it("lists computer use in slash menu filter", () => {
        const matches = filterSlashCommands("computer");
        assert.ok(matches.some((command) => command.id === "computer_use"));
    });

    it("matches computer when slash menu query is a prefix", () => {
        const matches = filterSlashCommands("comp");
        assert.ok(matches.some((command) => command.id === "computer_use"));
    });

    it("does not treat /computer as a built-in chat command id", () => {
        assert.equal(matchChatCommand("/computer"), null);
        assert.equal(matchChatCommand("/computer open Safari"), null);
    });

    it("parses /computer invocations", () => {
        assert.deepEqual(parseComputerUseInvocation("/computer use"), { rest: "" });
        assert.deepEqual(parseComputerUseInvocation("/computer"), { rest: "" });
        assert.deepEqual(parseComputerUseInvocation("/computer-use click OK"), {
            rest: "click OK",
        });
        assert.deepEqual(parseComputerUseInvocation("/computer_use click OK"), {
            rest: "click OK",
        });
        assert.deepEqual(parseComputerUseInvocation("/Computer Use click OK"), {
            rest: "click OK",
        });
    });

    it("builds prompts based on enable flag", () => {
        assert.match(buildComputerUsePrompt("", { enabled: false }), /未在设置中启用/);
        assert.match(buildComputerUsePrompt("open Settings", { enabled: true }), /open Settings/);
        const enabledPrompt = buildComputerUsePrompt("", { enabled: true });
        assert.match(enabledPrompt, /computer_action/);
        assert.match(enabledPrompt, /截图.*观察.*执行.*验证/);
        assert.match(enabledPrompt, /drag/);
    });
});
