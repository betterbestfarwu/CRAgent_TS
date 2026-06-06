import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildSessionImageUrl,
    parseSessionImageUrl,
    SESSION_IMAGE_SCHEME,
} from "../src/shared/sessionImageUrl.js";

describe("sessionImageUrl", () => {
    it("builds and parses session image URLs", () => {
        const url = buildSessionImageUrl("session-1", "msg-1-0.png");
        assert.match(url, new RegExp(`^${SESSION_IMAGE_SCHEME}://local/`));
        assert.deepEqual(parseSessionImageUrl(url), {
            sessionId: "session-1",
            imageFile: "msg-1-0.png",
        });
    });

    it("returns empty url when args are missing", () => {
        assert.equal(buildSessionImageUrl("", "msg-1-0.png"), "");
        assert.equal(buildSessionImageUrl("session-1", ""), "");
    });
});
