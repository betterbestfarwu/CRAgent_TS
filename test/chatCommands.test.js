import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildComputerUsePrompt,
    filterSlashCommands,
    matchChatCommand,
    parseComputerUseInvocation,
} from "../src/shared/chatCommands.js";

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
