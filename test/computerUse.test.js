import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import {
    isToolErrorResult,
    normalizeToolResult,
    toolResultContent,
} from "../src/shared/toolResult.js";
import { messagesToApiPayloads, parseAssistantContent } from "../src/main/llmClient.js";
import { shouldRequireToolConfirmation } from "../src/main/authPolicy.js";
import { ToolRegistry } from "../src/main/toolRegistry.js";
import { createComputerUseTools } from "../src/main/tools/computerUseTools.js";
import { isComputerUseSupported } from "../src/main/computerUse.js";
import {
    dipPointToPlatformPoint,
    dipRectToPlatformRect,
    formatMacScreencaptureRegion,
    getDisplayLayout,
    resolveDisplayTarget,
    resolveGlobalPoint,
    setComputerUseScreenGetter,
} from "../src/main/computerUseDisplays.js";

function mockScreen() {
    const displays = [
        {
            id: 1,
            label: "Built-in",
            bounds: { x: 0, y: 0, width: 1440, height: 900 },
            workArea: { x: 0, y: 25, width: 1440, height: 875 },
            scaleFactor: 2,
        },
        {
            id: 2,
            label: "External",
            bounds: { x: 1440, y: 0, width: 1920, height: 1080 },
            workArea: { x: 1440, y: 0, width: 1920, height: 1080 },
            scaleFactor: 1,
        },
    ];
    return {
        getAllDisplays: () => displays,
        getPrimaryDisplay: () => displays[0],
        dipToScreenPoint: (point) => ({
            x: Math.round(point.x * 2),
            y: Math.round(point.y * 2),
        }),
    };
}

describe("toolResult", () => {
    it("normalizes string results", () => {
        assert.deepEqual(normalizeToolResult("ok"), { content: "ok", images: undefined });
    });

    it("normalizes structured results with images", () => {
        const image = { mimeType: "image/png", dataUrl: "data:image/png;base64,abc" };
        assert.deepEqual(normalizeToolResult({ text: "shot", images: [image] }), {
            content: "shot",
            images: [image],
        });
    });

    it("strips inline image payloads from text results", () => {
        const dataUrl = `data:image/png;base64,${"A".repeat(4096)}`;
        const normalized = normalizeToolResult(`Generated: ${dataUrl}`);

        assert.doesNotMatch(normalized.content, /AAAA/);
        assert.match(normalized.content, /\[image payload omitted: image\/png/);
    });

    it("detects tool errors", () => {
        assert.equal(isToolErrorResult("Error: nope"), true);
        assert.equal(isToolErrorResult({ text: "Error: nope" }), true);
    });

    it("extracts text content", () => {
        assert.equal(toolResultContent({ content: "hello" }), "hello");
    });
});

describe("llmClient messagesToApiPayloads", () => {
    it("expands tool images into a follow-up user message for the API", () => {
        const payloads = messagesToApiPayloads([
            {
                role: "tool",
                name: "computer_screenshot",
                toolCallId: "call_1",
                content: "Desktop screenshot captured.",
                images: [{ mimeType: "image/png", dataUrl: "data:image/png;base64,abc" }],
            },
        ]);

        assert.equal(payloads.length, 2);
        assert.equal(payloads[0].role, "tool");
        assert.equal(payloads[0].content, "Desktop screenshot captured.");
        assert.equal(payloads[1].role, "user");
        assert.equal(Array.isArray(payloads[1].content), true);
        assert.equal(payloads[1].content[1].type, "image_url");
    });

    it("expands assistant images into a follow-up visual message for the API", () => {
        const payloads = messagesToApiPayloads([
            {
                role: "assistant",
                content: "",
                images: [{ mimeType: "image/png", dataUrl: "data:image/png;base64,abc" }],
            },
        ]);

        assert.equal(payloads.length, 2);
        assert.equal(payloads[0].role, "assistant");
        assert.equal(payloads[1].role, "user");
        assert.equal(payloads[1].content[0].text, "[Visual output from assistant]");
        assert.equal(payloads[1].content[1].type, "image_url");
    });

    it("strips inline image payload text before API payloads", () => {
        const dataUrl = `data:image/png;base64,${"A".repeat(4096)}`;
        const payloads = messagesToApiPayloads([
            {
                role: "tool",
                name: "image_tool",
                toolCallId: "call_1",
                content: `Generated: ${dataUrl}`,
            },
        ]);

        assert.doesNotMatch(payloads[0].content, /AAAA/);
        assert.match(payloads[0].content, /\[image payload omitted: image\/png/);
    });
});

describe("llmClient parseAssistantContent", () => {
    it("extracts assistant image blocks from multimodal content arrays", () => {
        const parsed = parseAssistantContent([
            { type: "text", text: "Here is the render" },
            {
                type: "image_url",
                image_url: { url: "data:image/png;base64,QUJD" },
            },
        ]);

        assert.equal(parsed.content, "Here is the render");
        assert.deepEqual(parsed.images, [
            { mimeType: "image/png", dataUrl: "data:image/png;base64,QUJD" },
        ]);
    });

    it("supports image-only assistant replies", () => {
        const parsed = parseAssistantContent([
            {
                type: "image",
                mimeType: "image/png",
                data: "QUJD",
            },
        ]);

        assert.equal(parsed.content, "");
        assert.deepEqual(parsed.images, [
            { mimeType: "image/png", dataUrl: "data:image/png;base64,QUJD" },
        ]);
    });
});

describe("computer use displays", () => {
    afterEach(() => {
        setComputerUseScreenGetter(null);
    });

    it("maps global points to display indices", () => {
        setComputerUseScreenGetter(mockScreen());
        const layout = getDisplayLayout();
        assert.equal(layout.displays.length, 2);
        assert.equal(layout.virtualBounds.width, 3360);

        const primaryPoint = resolveGlobalPoint(100, 100);
        assert.equal(primaryPoint.displayIndex, 0);

        const externalPoint = resolveGlobalPoint(1500, 200);
        assert.equal(externalPoint.displayIndex, 1);

        const outside = resolveGlobalPoint(4000, 200);
        assert.equal(outside.displayIndex, null);
    });

    it("resolves display targets by index", () => {
        setComputerUseScreenGetter(mockScreen());
        const target = resolveDisplayTarget("1");
        assert.equal(target.mode, "single");
        assert.equal(target.display.index, 1);
        assert.equal(target.display.bounds.x, 1440);
    });

    it("converts dip points and rects to platform coordinates", () => {
        setComputerUseScreenGetter(mockScreen());
        assert.deepEqual(dipPointToPlatformPoint(10, 20), { x: 20, y: 40 });
        assert.deepEqual(dipRectToPlatformRect({ x: 0, y: 0, width: 100, height: 50 }), {
            x: 0,
            y: 0,
            width: 200,
            height: 100,
        });
    });

    it("formats screencapture -R as x,y,width,height", () => {
        assert.equal(
            formatMacScreencaptureRegion({ x: 0, y: 0, width: 1920, height: 1080 }),
            "0,0,1920,1080",
        );
        assert.equal(
            formatMacScreencaptureRegion({ x: 1440, y: 0, width: 1920, height: 1080 }),
            "1440,0,1920,1080",
        );
    });
});

describe("computer use tools", () => {
    it("passes execution context to tools with optional context parameter", async () => {
        let receivedContext;
        const registry = new ToolRegistry(() => [
            {
                name: "context_probe",
                requiresConfirmation: false,
                enabled: () => true,
                schema: {
                    type: "function",
                    function: {
                        name: "context_probe",
                        parameters: { type: "object", properties: {} },
                    },
                },
                async execute(_args, context = {}) {
                    receivedContext = context;
                    return "ok";
                },
            },
        ]);

        await registry.execute(
            {
                id: "call-context",
                function: { name: "context_probe", arguments: "{}" },
            },
            { sessionId: "session-123" },
        );

        assert.equal(receivedContext?.sessionId, "session-123");
    });

    it("forwards sessionId so fullAccess auth skips inline confirmations", async () => {
        let confirmCalls = 0;
        const confirmToolExecution = async () => {
            confirmCalls += 1;
            return true;
        };
        const getAuthMode = (sessionId) => (sessionId === "session-full" ? "fullAccess" : "default");
        const registry = new ToolRegistry(
            () => [
                {
                    name: "inline_confirm_probe",
                    requiresConfirmation: false,
                    enabled: () => true,
                    schema: {
                        type: "function",
                        function: {
                            name: "inline_confirm_probe",
                            parameters: { type: "object", properties: {} },
                        },
                    },
                    async execute(_args, context = {}) {
                        const needsConfirm = shouldRequireToolConfirmation(
                            { requiresConfirmation: true },
                            () => getAuthMode(context.sessionId),
                        );
                        if (needsConfirm) {
                            await confirmToolExecution("inline_confirm_probe", "summary");
                        }
                        return context.sessionId || "missing-session";
                    },
                },
            ],
            confirmToolExecution,
            getAuthMode,
        );

        const result = await registry.execute(
            {
                id: "call-inline-confirm",
                function: { name: "inline_confirm_probe", arguments: "{}" },
            },
            { sessionId: "session-full" },
        );

        assert.equal(result, "session-full");
        assert.equal(confirmCalls, 0);
    });

    it("registers tools only when enable_computer_use is true", () => {
        if (!isComputerUseSupported()) {
            return;
        }
        const disabled = createComputerUseTools({
            getAgentTools: () => ({ enable_tools: true, enable_computer_use: false }),
            confirmToolExecution: async () => true,
        });
        assert.equal(disabled.every((tool) => !tool.enabled()), true);

        const enabled = createComputerUseTools({
            getAgentTools: () => ({ enable_tools: true, enable_computer_use: true }),
            confirmToolExecution: async () => true,
        });
        assert.equal(
            enabled
                .filter((tool) => tool.enabled())
                .map((tool) => tool.name)
                .sort()
                .join(","),
            "computer_click,computer_displays,computer_key,computer_move,computer_screenshot,computer_scroll,computer_type",
        );
    });
});
