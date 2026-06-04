import { shouldRequireToolConfirmation } from "../authPolicy.js";
import {
    captureScreenshot,
    clickAt,
    computerUseSystemPromptSection,
    describeDisplays,
    isComputerUseSupported,
    moveTo,
    pressKey,
    scroll,
    typeText,
} from "../computerUse.js";

function fnSchema(name, description, parameters) {
    return {
        type: "function",
        function: { name, description, parameters },
    };
}

function computerEnabled(getAgentTools) {
    return () => {
        if (!isComputerUseSupported()) {
            return false;
        }
        const tools = getAgentTools();
        if (tools.enable_tools === false) {
            return false;
        }
        return tools.enable_computer_use === true;
    };
}

export { computerUseSystemPromptSection };

export function createComputerUseTools({ getAgentTools, confirmToolExecution, getAuthMode }) {
    const enabled = computerEnabled(getAgentTools);

    async function confirmComputerAction(toolName, summary, sessionId) {
        const needsConfirm = shouldRequireToolConfirmation(
            { requiresConfirmation: true },
            () => (typeof getAuthMode === "function" ? getAuthMode(sessionId) : "default"),
        );
        if (!needsConfirm) {
            return;
        }
        const approved = await confirmToolExecution(toolName, summary);
        if (!approved) {
            throw new Error(`user declined: ${toolName}`);
        }
    }

    return [
        {
            name: "computer_displays",
            requiresConfirmation: false,
            enabled,
            schema: fnSchema(
                "computer_displays",
                "List all connected displays with global bounds for multi-monitor coordinate mapping.",
                { type: "object", properties: {} },
            ),
            async execute() {
                return describeDisplays();
            },
        },
        {
            name: "computer_screenshot",
            requiresConfirmation: false,
            enabled,
            schema: fnSchema(
                "computer_screenshot",
                "Capture the desktop and return a PNG image. Coordinates in the image match global DIP bounds from computer_displays.",
                {
                    type: "object",
                    properties: {
                        display: {
                            type: "string",
                            description:
                                'Display target: "main", "all", or a numeric index from computer_displays (e.g. "0", "1"). Default main.',
                        },
                    },
                },
            ),
            async execute(args, context = {}) {
                const display = args.display ?? "main";
                await confirmComputerAction(
                    "computer_screenshot",
                    `Capture desktop screenshot (display=${display})`,
                    context.sessionId,
                );
                const { image, caption } = await captureScreenshot({ display });
                return {
                    text: `${caption}\n\nInspect the attached image before clicking or typing.`,
                    images: [image],
                };
            },
        },
        {
            name: "computer_move",
            requiresConfirmation: false,
            enabled,
            schema: fnSchema(
                "computer_move",
                "Move the mouse cursor to absolute global coordinates without clicking.",
                {
                    type: "object",
                    properties: {
                        x: {
                            type: "number",
                            description: "Horizontal coordinate in global DIP pixels",
                        },
                        y: {
                            type: "number",
                            description: "Vertical coordinate in global DIP pixels",
                        },
                    },
                    required: ["x", "y"],
                },
            ),
            async execute(args, context = {}) {
                await confirmComputerAction(
                    "computer_move",
                    `Move cursor to (${args.x}, ${args.y})`,
                    context.sessionId,
                );
                return moveTo({ x: args.x, y: args.y });
            },
        },
        {
            name: "computer_click",
            requiresConfirmation: false,
            enabled,
            schema: fnSchema(
                "computer_click",
                "Click at absolute global coordinates (DIP pixels from computer_displays).",
                {
                    type: "object",
                    properties: {
                        x: {
                            type: "number",
                            description: "Horizontal coordinate in global DIP pixels",
                        },
                        y: {
                            type: "number",
                            description: "Vertical coordinate in global DIP pixels",
                        },
                        button: {
                            type: "string",
                            enum: ["left", "right", "double"],
                            description: "Mouse button action. Default left.",
                        },
                    },
                    required: ["x", "y"],
                },
            ),
            async execute(args, context = {}) {
                const button = args.button || "left";
                await confirmComputerAction(
                    "computer_click",
                    `${button} click at (${args.x}, ${args.y})`,
                    context.sessionId,
                );
                return clickAt({ x: args.x, y: args.y, button });
            },
        },
        {
            name: "computer_type",
            requiresConfirmation: false,
            enabled,
            schema: fnSchema(
                "computer_type",
                "Type text into the currently focused application using the keyboard.",
                {
                    type: "object",
                    properties: {
                        text: { type: "string", description: "Text to type" },
                        clear_first: {
                            type: "boolean",
                            description: "If true, select all and clear before typing.",
                        },
                    },
                    required: ["text"],
                },
            ),
            async execute(args, context = {}) {
                const preview = String(args.text ?? "").slice(0, 120);
                await confirmComputerAction(
                    "computer_type",
                    `Type text${args.clear_first ? " (clear first)" : ""}: ${preview}${String(args.text ?? "").length > 120 ? "…" : ""}`,
                    context.sessionId,
                );
                return typeText({ text: args.text, clear_first: args.clear_first });
            },
        },
        {
            name: "computer_key",
            requiresConfirmation: false,
            enabled,
            schema: fnSchema(
                "computer_key",
                "Press a key or key chord, e.g. enter, tab, escape, cmd+a, ctrl+c, shift+tab.",
                {
                    type: "object",
                    properties: {
                        key: {
                            type: "string",
                            description:
                                "Key name or chord with + separators (cmd/ctrl/alt/shift modifiers)",
                        },
                    },
                    required: ["key"],
                },
            ),
            async execute(args, context = {}) {
                await confirmComputerAction(
                    "computer_key",
                    `Press key: ${args.key}`,
                    context.sessionId,
                );
                return pressKey({ key: args.key });
            },
        },
        {
            name: "computer_scroll",
            requiresConfirmation: false,
            enabled,
            schema: fnSchema(
                "computer_scroll",
                "Scroll using the mouse wheel (line increments). Optionally move the cursor first with x/y.",
                {
                    type: "object",
                    properties: {
                        direction: {
                            type: "string",
                            enum: ["up", "down", "left", "right"],
                            description: "Scroll direction. Default down.",
                        },
                        amount: {
                            type: "integer",
                            description: "Wheel lines/clicks (1-20). Default 3.",
                        },
                        x: {
                            type: "number",
                            description: "Optional: move cursor here before scrolling (global DIP x)",
                        },
                        y: {
                            type: "number",
                            description: "Optional: move cursor here before scrolling (global DIP y)",
                        },
                    },
                },
            ),
            async execute(args, context = {}) {
                const direction = args.direction || "down";
                const amount = args.amount ?? 3;
                const at =
                    args.x != null && args.y != null ? { x: args.x, y: args.y } : undefined;
                const atHint = at ? ` at (${at.x}, ${at.y})` : "";
                await confirmComputerAction(
                    "computer_scroll",
                    `Scroll ${direction} (${amount})${atHint}`,
                    context.sessionId,
                );
                return scroll({ direction, amount, at });
            },
        },
    ];
}
