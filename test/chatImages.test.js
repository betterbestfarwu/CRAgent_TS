import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    htmlImageDataUrlsToAttachments,
    extractHtmlImageDataUrls,
} from "../src/shared/chatImages.js";

describe("extractHtmlImageDataUrls", () => {
    it("extracts data URL images from copied chat HTML", () => {
        const html = [
            "<div>",
            '<p>hello</p>',
            '<img alt="image" src="data:image/png;base64,QUJD">',
            '<img src="cragent-session://local/s1/m1-0.png">',
            '<img src="data:image/jpeg;base64,REVG">',
            "</div>",
        ].join("");

        assert.deepEqual(extractHtmlImageDataUrls(html), [
            "data:image/png;base64,QUJD",
            "data:image/jpeg;base64,REVG",
        ]);
    });
});

describe("htmlImageDataUrlsToAttachments", () => {
    it("converts copied chat HTML images into composer attachments", () => {
        const attachments = htmlImageDataUrlsToAttachments(
            '<img src="data:image/png;base64,QUJD">',
            { idFactory: () => "img-1" },
        );

        assert.deepEqual(attachments, [
            {
                id: "img-1",
                mimeType: "image/png",
                dataUrl: "data:image/png;base64,QUJD",
                name: "pasted-image.png",
            },
        ]);
    });
});
