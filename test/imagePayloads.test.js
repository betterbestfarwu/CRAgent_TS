import test from "node:test";
import assert from "node:assert/strict";
import {
    extractInlineImagePayloads,
    stripInlineImagePayloads,
} from "../src/shared/imagePayloads.js";

test("stripInlineImagePayloads replaces image data URLs with a short placeholder", () => {
    const text = `![generated](data:image/png;base64,${"A".repeat(4096)})`;
    const stripped = stripInlineImagePayloads(text);

    assert.doesNotMatch(stripped, /AAAA/);
    assert.match(stripped, /\[image payload omitted: image\/png/);
});

test("stripInlineImagePayloads replaces common generated-image base64 fields", () => {
    const text = JSON.stringify({
        data: [{ b64_json: "B".repeat(4096) }],
    });
    const stripped = stripInlineImagePayloads(text);

    assert.doesNotMatch(stripped, /BBBB/);
    assert.match(stripped, /\[image payload omitted: image/);
});

test("extractInlineImagePayloads pulls markdown data URL images into attachments", () => {
    const extracted = extractInlineImagePayloads(
        `Here is the result:\n![image](data:image/png;base64,QUJD)`,
    );

    assert.equal(extracted.text, "Here is the result:");
    assert.deepEqual(extracted.images, [
        { mimeType: "image/png", dataUrl: "data:image/png;base64,QUJD" },
    ]);
});
