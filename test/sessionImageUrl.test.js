import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildSessionImageUrl,
    inferSessionImageFile,
    parseSessionImageUrl,
    resolveSessionImageWireFields,
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

    it("infers externalized image filenames", () => {
        assert.equal(inferSessionImageFile("msg-1", 0, "image/jpeg"), "msg-1-0.jpg");
        assert.equal(inferSessionImageFile("msg-1", 2), "msg-1-2.png");
    });

    it("builds direct wire fields for desktop session images", () => {
        const wire = resolveSessionImageWireFields("session-1", "msg-1", {
            mimeType: "image/png",
            hasData: true,
        }, 0, { useDirectImageSrc: true });
        assert.equal(wire.image_file, "msg-1-0.png");
        assert.match(wire.image_src, /^cragent-session:\/\/local\//);
        assert.equal(wire.data_url, undefined);
    });
});
