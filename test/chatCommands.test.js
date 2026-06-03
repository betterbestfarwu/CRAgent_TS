import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildComputerUsePrompt,
    filterSlashCommands,
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

    it("returns null when slash is not active at end", () => {
        assert.equal(parseActiveSlashCommand("/help more"), null);
    });
});

describe("chatCommands computer use", () => {
    it("lists computer use in slash menu filter", () => {
        const matches = filterSlashCommands("computer");
        assert.ok(matches.some((command) => command.id === "computer_use"));
    });

    it("does not treat /computer use as a built-in chat command id", () => {
        assert.equal(matchChatCommand("/computer use"), null);
        assert.equal(matchChatCommand("/computer use open Safari"), null);
    });

    it("parses /computer use invocations", () => {
        assert.deepEqual(parseComputerUseInvocation("/computer use"), { rest: "" });
        assert.deepEqual(parseComputerUseInvocation("/Computer Use click OK"), {
            rest: "click OK",
        });
        assert.equal(parseComputerUseInvocation("/computer"), null);
    });

    it("builds prompts based on enable flag", () => {
        assert.match(buildComputerUsePrompt("", { enabled: false }), /未在设置中启用/);
        assert.match(buildComputerUsePrompt("open Settings", { enabled: true }), /open Settings/);
        assert.match(buildComputerUsePrompt("", { enabled: true }), /computer_displays/);
    });
});
