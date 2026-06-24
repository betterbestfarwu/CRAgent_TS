import { shouldRequireToolConfirmation } from "../authPolicy.js";
import {
    captureScreenshot,
    clickAt,
    computerUseSystemPromptSection,
    describeDisplays,
    dragTo,
    isComputerUseSupported,
    moveTo,
    openApp,
    pressKey,
    scroll,
    typeText,
    waitForComputer,
} from "../computerUse.js";
import { resolvePointerCoordinates } from "../computerUseDisplays.js";

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

const DEFAULT_COMPUTER_USE_TIMEOUT_MS = 60_000;

async function runComputerActionWithTimeout(toolName, context, operation) {
    const timeoutMs = Number(context.computerUseTimeoutMs ?? DEFAULT_COMPUTER_USE_TIMEOUT_MS);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return operation(context.signal);
    }

    const controller = new AbortController();
    const abortFromParent = () => controller.abort(context.signal?.reason);
    if (context.signal?.aborted) {
        abortFromParent();
    } else {
        context.signal?.addEventListener?.("abort", abortFromParent, { once: true });
    }

    let timeoutId;
    try {
        return await new Promise((resolve, reject) => {
            timeoutId = setTimeout(() => {
                controller.abort(new Error(`${toolName} timed out after ${timeoutMs}ms`));
                reject(new Error(`${toolName} timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            Promise.resolve(operation(controller.signal)).then(resolve, reject);
        });
    } finally {
        clearTimeout(timeoutId);
        context.signal?.removeEventListener?.("abort", abortFromParent);
    }
}

export function createComputerUseTools({ getAgentTools, confirmToolExecution, getAuthMode }) {
    const enabled = computerEnabled(getAgentTools);

    function isReadOnlyComputerAction(toolName, args = {}) {
        if (toolName === "computer_displays" || toolName === "computer_screenshot") {
            return true;
        }
        if (toolName === "computer_action") {
            return String(args.action || "").toLowerCase() === "screenshot";
        }
        return false;
    }

    async function confirmComputerAction(toolName, summary, sessionId, args = {}) {
        if (isReadOnlyComputerAction(toolName, args)) {
            return;
        }
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
            name: "computer_action",
            requiresConfirmation: false,
            enabled,
            schema: fnSchema(
                "computer_action",
                "Preferred high-level computer-use action tool. Use screenshot-observe-act-verify loops for desktop control.",
                {
                    type: "object",
                    properties: {
                        action: {
                            type: "string",
                            enum: [
                                "screenshot",
                                "move",
                                "click",
                                "double_click",
                                "drag",
                                "type",
                                "key",
                                "scroll",
                                "wait",
                                "open_app",
                            ],
                            description: "Desktop action to perform.",
                        },
                        display: {
                            type: "string",
                            description:
                                'For screenshot: "main", "all", or numeric display index. Default main.',
                        },
                        x: {
                            type: "number",
                            description: "Global DIP x coordinate for pointer actions.",
                        },
                        y: {
                            type: "number",
                            description: "Global DIP y coordinate for pointer actions.",
                        },
                        to_x: {
                            type: "number",
                            description: "Drag destination global DIP x coordinate.",
                        },
                        to_y: {
                            type: "number",
                            description: "Drag destination global DIP y coordinate.",
                        },
                        button: {
                            type: "string",
                            enum: ["left", "right", "double"],
                            description: "Mouse button for click. Default left.",
                        },
                        text: {
                            type: "string",
                            description: "Text for type action.",
                        },
                        clear_first: {
                            type: "boolean",
                            description: "For type action, select all and clear before typing.",
                        },
                        key: {
                            type: "string",
                            description: "Key or key chord for key action, e.g. enter, cmd+a.",
                        },
                        direction: {
                            type: "string",
                            enum: ["up", "down", "left", "right"],
                            description: "Scroll direction. Default down.",
                        },
                        amount: {
                            type: "integer",
                            description: "Scroll wheel lines/clicks (1-20). Default 3.",
                        },
                        duration_ms: {
                            type: "integer",
                            description: "Drag duration in milliseconds. Default 500.",
                        },
                        ms: {
                            type: "integer",
                            description: "Wait duration in milliseconds. Default 1000.",
                        },
                        app: {
                            type: "string",
                            description:
                                'Application name for open_app, e.g. "Google Chrome", "Safari", "Visual Studio Code".',
                        },
                    },
                    required: ["action"],
                },
            ),
            async execute(args, context = {}) {
                return runComputerActionWithTimeout("computer_action", context, async (signal) => {
                    const action = String(args.action || "").toLowerCase();
                    if (action === "screenshot") {
                        const display = args.display ?? "main";
                        await confirmComputerAction(
                            "computer_action",
                            `Capture desktop screenshot (display=${display})`,
                            context.sessionId,
                            args,
                        );
                        const { image, caption } = await captureScreenshot({ display, signal });
                        return {
                            text: `${caption}\n\nInspect the attached image before clicking or typing.`,
                            images: [image],
                        };
                    }
                    if (action === "move") {
                        await confirmComputerAction(
                            "computer_action",
                            `Move cursor to (${args.x}, ${args.y})`,
                            context.sessionId,
                        );
                        return moveTo({ ...args, signal });
                    }
                    if (action === "click" || action === "double_click") {
                        const button =
                            action === "double_click" ? "double" : args.button || "left";
                        await confirmComputerAction(
                            "computer_action",
                            `${button} click at (${args.x}, ${args.y})`,
                            context.sessionId,
                        );
                        return clickAt({ ...args, button, signal });
                    }
                    if (action === "drag") {
                        await confirmComputerAction(
                            "computer_action",
                            `Drag from (${args.x}, ${args.y}) to (${args.to_x}, ${args.to_y})`,
                            context.sessionId,
                        );
                        return dragTo({ ...args, signal });
                    }
                    if (action === "type") {
                        const preview = String(args.text ?? "").slice(0, 120);
                        await confirmComputerAction(
                            "computer_action",
                            `Type text${args.clear_first ? " (clear first)" : ""}: ${preview}${String(args.text ?? "").length > 120 ? "…" : ""}`,
                            context.sessionId,
                        );
                        return typeText({
                            text: args.text,
                            clear_first: args.clear_first,
                            signal,
                        });
                    }
                    if (action === "key") {
                        await confirmComputerAction(
                            "computer_action",
                            `Press key: ${args.key}`,
                            context.sessionId,
                        );
                        return pressKey({ key: args.key, signal });
                    }
                    if (action === "scroll") {
                        const direction = args.direction || "down";
                        const amount = args.amount ?? 3;
                        const coords = resolvePointerCoordinates(args);
                        const at =
                            Number.isFinite(coords.x) && Number.isFinite(coords.y)
                                ? { x: coords.x, y: coords.y }
                                : undefined;
                        const atHint = at ? ` at (${at.x}, ${at.y})` : "";
                        await confirmComputerAction(
                            "computer_action",
                            `Scroll ${direction} (${amount})${atHint}`,
                            context.sessionId,
                        );
                        return scroll({ direction, amount, at, signal });
                    }
                    if (action === "wait") {
                        const ms = args.ms ?? 1000;
                        await confirmComputerAction(
                            "computer_action",
                            `Wait ${ms}ms`,
                            context.sessionId,
                        );
                        return waitForComputer({ ms, signal });
                    }
                    if (action === "open_app") {
                        const app = String(args.app ?? "").trim();
                        await confirmComputerAction(
                            "computer_action",
                            `Open app: ${app}`,
                            context.sessionId,
                        );
                        return openApp({ app, signal });
                    }
                    throw new Error(`Unsupported computer_action action: ${args.action}`);
                });
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
                return runComputerActionWithTimeout(
                    "computer_screenshot",
                    context,
                    async (signal) => {
                        const display = args.display ?? "main";
                        await confirmComputerAction(
                            "computer_screenshot",
                            `Capture desktop screenshot (display=${display})`,
                            context.sessionId,
                        );
                        const { image, caption } = await captureScreenshot({ display, signal });
                        return {
                            text: `${caption}\n\nInspect the attached image before clicking or typing.`,
                            images: [image],
                        };
                    },
                );
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
                return runComputerActionWithTimeout("computer_move", context, async (signal) => {
                    await confirmComputerAction(
                        "computer_move",
                        `Move cursor to (${args.x}, ${args.y})`,
                        context.sessionId,
                    );
                    return moveTo({ ...args, signal });
                });
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
                return runComputerActionWithTimeout("computer_click", context, async (signal) => {
                    const button = args.button || "left";
                    await confirmComputerAction(
                        "computer_click",
                        `${button} click at (${args.x}, ${args.y})`,
                        context.sessionId,
                    );
                    return clickAt({ ...args, button, signal });
                });
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
                return runComputerActionWithTimeout("computer_type", context, async (signal) => {
                    const preview = String(args.text ?? "").slice(0, 120);
                    await confirmComputerAction(
                        "computer_type",
                        `Type text${args.clear_first ? " (clear first)" : ""}: ${preview}${String(args.text ?? "").length > 120 ? "…" : ""}`,
                        context.sessionId,
                    );
                    return typeText({
                        text: args.text,
                        clear_first: args.clear_first,
                        signal,
                    });
                });
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
                return runComputerActionWithTimeout("computer_key", context, async (signal) => {
                    await confirmComputerAction(
                        "computer_key",
                        `Press key: ${args.key}`,
                        context.sessionId,
                    );
                    return pressKey({ key: args.key, signal });
                });
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
                return runComputerActionWithTimeout("computer_scroll", context, async (signal) => {
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
                    return scroll({ direction, amount, at, signal });
                });
            },
        },
    ];
}
