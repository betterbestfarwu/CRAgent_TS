import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
    dipPointToPlatformPoint,
    dipRectToPlatformRect,
    formatMacScreencaptureRegion,
    formatDisplayLayoutForPrompt,
    getDisplayLayout,
    resolveDisplayTarget,
    resolveGlobalPoint,
    resolvePointerCoordinates,
} from "./computerUseDisplays.js";

const execFileAsync = promisify(execFile);

export const MAX_SCREENSHOT_DIMENSION = 1920;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

export {
    formatDisplayLayoutForPrompt,
    getDisplayLayout,
    resolveDisplayTarget,
    resolveGlobalPoint,
    resolvePointerCoordinates,
    setComputerUseScreenGetter,
} from "./computerUseDisplays.js";

export function isComputerUseSupported(platform = process.platform) {
    return platform === "darwin" || platform === "win32";
}

export function computerActionFingerprint(toolCall) {
    const name = toolCall?.function?.name;
    if (!name || !name.startsWith("computer")) {
        return null;
    }
    let args = {};
    try {
        args = JSON.parse(toolCall.function.arguments || "{}");
    } catch {
        return `${name}:${toolCall.function.arguments || ""}`;
    }
    if (name === "computer_action") {
        const action = String(args.action || "").toLowerCase();
        if (action === "screenshot") {
            return null;
        }
        if (action === "key") {
            return `key:${String(args.key || "").toLowerCase()}`;
        }
        if (action === "open_app") {
            return `open_app:${String(args.app || "").toLowerCase()}`;
        }
        return `action:${action}:${JSON.stringify(args)}`;
    }
    if (name === "computer_key") {
        return `key:${String(args.key || "").toLowerCase()}`;
    }
    return `${name}:${JSON.stringify(args)}`;
}

export function formatComputerLoopNudge(repeatCount = 3) {
    return (
        `\n\n[system] The same desktop action was repeated ${repeatCount} times without progress. ` +
        "Take a fresh screenshot, verify the UI changed, and switch strategy " +
        '(e.g. computer_action open_app, click a Dock icon, or a different shortcut).'
    );
}

export function computerUseSystemPromptSection() {
    return [
        "<computer_use>",
        "Use computer_* tools only when the task requires desktop interaction. Use a vision-capable model.",
        "Prefer computer_action for built-in-style desktop control. Low-level computer_displays, computer_screenshot, computer_move, computer_click, computer_type, computer_key, and computer_scroll remain available.",
        "Workflow: computer_action({action:\"screenshot\"}) or computer_displays → inspect the result → act with computer_action → verify important UI changes with another screenshot.",
        "Supported computer_action actions: screenshot, move, click, double_click, drag, type, key, scroll, wait, open_app.",
        "Use global virtual-desktop coordinates in DIP/logical pixels from Electron display.bounds.",
        "On multi-monitor setups, call computer_displays before any coordinate-based action.",
        "Prefer computer_key for shortcuts when possible; use computer_type for literal text entry.",
        "To launch an app, prefer computer_action({action:\"open_app\", app:\"Google Chrome\"}) on macOS/Windows instead of repeating Spotlight shortcuts.",
        "If using Spotlight (cmd+space), type the app name and press enter in the same step — do not press cmd+space repeatedly.",
        "If two consecutive screenshots look unchanged, switch strategy instead of repeating the same key or click.",
        "On macOS, grant Accessibility permission to CRAgent if input tools fail.",
        "</computer_use>",
    ].join("\n");
}

function escapeAppleScriptString(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapePowerShellSingleQuoted(value) {
    return String(value).replace(/'/g, "''");
}

async function runOsascript(script, signal) {
    if (signal?.aborted) {
        throw Object.assign(new Error("Aborted"), { name: "AbortError" });
    }
    await execFileAsync("/usr/bin/osascript", ["-e", script], signal ? { signal } : {});
}

async function runPowerShell(script) {
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    const executable = fsSync.existsSync(
        `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
    )
        ? `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
        : "powershell.exe";
    await execFileAsync(executable, [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
    ]);
}

async function runSwift(source) {
    await execFileAsync("/usr/bin/swift", ["-"], { input: source });
}

async function resizeScreenshotMac(filePath) {
    try {
        await execFileAsync("/usr/bin/sips", ["-Z", String(MAX_SCREENSHOT_DIMENSION), filePath]);
    } catch {
        // Best-effort resize; keep original if sips fails.
    }
}

async function readScreenshotDataUrl(filePath, meta = {}) {
    const buffer = await fs.readFile(filePath);
    if (buffer.length > MAX_SCREENSHOT_BYTES) {
        throw new Error(
            `Screenshot exceeds ${MAX_SCREENSHOT_BYTES} bytes; try a single display or lower resolution`,
        );
    }
    const base64 = buffer.toString("base64");
    return {
        mimeType: "image/png",
        dataUrl: `data:image/png;base64,${base64}`,
        width: meta.width ?? null,
        height: meta.height ?? null,
    };
}

async function captureScreenshotMacRegion(bounds) {
    const tmp = path.join(os.tmpdir(), `cragent-screenshot-${Date.now()}.png`);
    const rect = dipRectToPlatformRect(bounds);
    const region = formatMacScreencaptureRegion(rect);
    try {
        await execFileAsync("/usr/sbin/screencapture", ["-x", "-t", "png", "-R", region, tmp]);
        await resizeScreenshotMac(tmp);
        return readScreenshotDataUrl(tmp, { width: bounds.width, height: bounds.height });
    } finally {
        await fs.unlink(tmp).catch(() => {});
    }
}

async function captureScreenshotMac(options = {}) {
    const target = resolveDisplayTarget(options.display ?? "main");
    if (target.mode === "all") {
        const tmp = path.join(os.tmpdir(), `cragent-screenshot-${Date.now()}.png`);
        try {
            await execFileAsync("/usr/sbin/screencapture", ["-x", "-t", "png", tmp]);
            await resizeScreenshotMac(tmp);
            return readScreenshotDataUrl(tmp, {
                width: target.layout.virtualBounds.width,
                height: target.layout.virtualBounds.height,
            });
        } finally {
            await fs.unlink(tmp).catch(() => {});
        }
    }
    return captureScreenshotMacRegion(target.display.bounds);
}

async function captureScreenshotWin(options = {}) {
    const target = resolveDisplayTarget(options.display ?? "main");
    const tmp = path.join(os.tmpdir(), `cragent-screenshot-${Date.now()}.png`);
    const tmpEscaped = escapePowerShellSingleQuoted(tmp);

    let bounds;
    if (target.mode === "all") {
        bounds = dipRectToPlatformRect(target.layout.virtualBounds);
    } else {
        bounds = dipRectToPlatformRect(target.display.bounds);
    }

    const script = `
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap ${bounds.width}, ${bounds.height}
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen(${bounds.x}, ${bounds.y}, 0, 0, $bitmap.Size)
$bitmap.Save('${tmpEscaped}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
`;
    try {
        await runPowerShell(script);
        return readScreenshotDataUrl(tmp, {
            width: target.mode === "all" ? target.layout.virtualBounds.width : target.display.bounds.width,
            height: target.mode === "all" ? target.layout.virtualBounds.height : target.display.bounds.height,
        });
    } finally {
        await fs.unlink(tmp).catch(() => {});
    }
}

export async function captureScreenshot(options = {}) {
    if (!isComputerUseSupported()) {
        throw new Error("Computer use is supported only on macOS and Windows");
    }
    const target = resolveDisplayTarget(options.display ?? "main");
    const image =
        process.platform === "darwin"
            ? await captureScreenshotMac(options)
            : await captureScreenshotWin(options);

    const displayLabel =
        target.mode === "all"
            ? "all displays"
            : `[${target.display.index}] ${target.display.label}`;

    return {
        image,
        caption: `Screenshot captured (${displayLabel}).\n\n${formatDisplayLayoutForPrompt(target.layout)}`,
    };
}

export function describeDisplays() {
    const layout = getDisplayLayout();
    return formatDisplayLayoutForPrompt(layout);
}

function formatPointResult(prefix, resolved) {
    const displayHint =
        resolved.displayIndex != null
            ? ` on display [${resolved.displayIndex}]`
            : " (outside known displays)";
    return `${prefix} at (${resolved.x}, ${resolved.y})${displayHint}`;
}

async function moveMac(resolved) {
    const source = `
import CoreGraphics
let point = CGPoint(x: ${resolved.x}, y: ${resolved.y})
if let event = CGEvent(
    mouseEventSource: nil,
    mouseType: .mouseMoved,
    mouseCursorPosition: point,
    mouseButton: .left
) {
    event.post(tap: .cghidEventTap)
}
`;
    await runSwift(source);
}

async function moveWin(resolved) {
    const platform = dipPointToPlatformPoint(resolved.x, resolved.y);
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class NativeMouse {
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);
}
"@
[NativeMouse]::SetCursorPos(${platform.x}, ${platform.y}) | Out-Null
`;
    await runPowerShell(script);
}

export async function moveTo(args) {
    if (args?.signal?.aborted) {
        throw Object.assign(new Error("Aborted"), { name: "AbortError" });
    }
    const { x, y } = resolvePointerCoordinates(args);
    const resolved = resolveGlobalPoint(x, y);
    if (process.platform === "darwin") {
        await moveMac(resolved);
    } else if (process.platform === "win32") {
        await moveWin(resolved);
    } else {
        throw new Error("Computer use is supported only on macOS and Windows");
    }
    return formatPointResult("Moved cursor", resolved);
}

async function clickMac(resolved, button = "left", signal) {
    await moveMac(resolved);
    const { x, y } = resolved;
    if (button === "double") {
        const script = `
tell application "System Events"
  click at {${x}, ${y}}
  delay 0.05
  click at {${x}, ${y}}
end tell`;
        await runOsascript(script, signal);
        return;
    }
    if (button === "right") {
        const script = `
tell application "System Events"
  right click at {${x}, ${y}}
end tell`;
        await runOsascript(script, signal);
        return;
    }
    const script = `
tell application "System Events"
  click at {${x}, ${y}}
end tell`;
    await runOsascript(script, signal);
}

async function clickWin(resolved, button = "left") {
    const platform = dipPointToPlatformPoint(resolved.x, resolved.y);
    const downFlag = button === "right" ? "0x0008" : "0x0002";
    const upFlag = button === "right" ? "0x0010" : "0x0004";
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class NativeMouse {
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);
}
"@
[NativeMouse]::SetCursorPos(${platform.x}, ${platform.y}) | Out-Null
[NativeMouse]::mouse_event(${downFlag}, 0, 0, 0, 0)
[NativeMouse]::mouse_event(${upFlag}, 0, 0, 0, 0)
${button === "double" ? `
Start-Sleep -Milliseconds 50
[NativeMouse]::mouse_event(${downFlag}, 0, 0, 0, 0)
[NativeMouse]::mouse_event(${upFlag}, 0, 0, 0, 0)
` : ""}
`;
    await runPowerShell(script);
}

export async function clickAt(args) {
    const { x, y } = resolvePointerCoordinates(args);
    const resolved = resolveGlobalPoint(x, y);
    const button = args.button || "left";
    const signal = args.signal;
    if (process.platform === "darwin") {
        await clickMac(resolved, button, signal);
    } else if (process.platform === "win32") {
        await clickWin(resolved, button);
    } else {
        throw new Error("Computer use is supported only on macOS and Windows");
    }
    return formatPointResult(`Clicked (${button})`, resolved);
}

function normalizeDurationMs(value, defaultMs, { min = 0, max = 10000, label = "ms" } = {}) {
    const resolved = value == null ? defaultMs : Number(value);
    if (!Number.isFinite(resolved) || resolved < min || resolved > max) {
        throw new Error(`${label} must be between ${min} and ${max}`);
    }
    return Math.round(resolved);
}

function waitWithAbort(ms, signal) {
    if (signal?.aborted) {
        return Promise.reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    }
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = () => {
            if (settled) {
                return;
            }
            settled = true;
            signal?.removeEventListener?.("abort", abort);
            resolve();
        };
        const abort = () => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        };
        const timer = setTimeout(finish, ms);
        signal?.addEventListener?.("abort", abort, { once: true });
    });
}

export async function waitForComputer({ ms = 1000, signal } = {}) {
    const duration = normalizeDurationMs(ms, 1000, { min: 0, max: 10000, label: "ms" });
    await waitWithAbort(duration, signal);
    return `Waited ${duration}ms`;
}

async function dragMac(start, end, durationMs) {
    const steps = Math.max(2, Math.min(60, Math.round(durationMs / 16)));
    const stepDelay = Math.max(0.005, durationMs / steps / 1000);
    const source = `
import CoreGraphics
import Foundation

let start = CGPoint(x: ${start.x}, y: ${start.y})
let end = CGPoint(x: ${end.x}, y: ${end.y})
let steps = ${steps}
let delay = ${stepDelay}

func post(_ type: CGEventType, _ point: CGPoint) {
    if let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left) {
        event.post(tap: .cghidEventTap)
    }
}

post(.leftMouseDown, start)
for index in 1...steps {
    let progress = CGFloat(index) / CGFloat(steps)
    let point = CGPoint(
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress
    )
    post(.leftMouseDragged, point)
    Thread.sleep(forTimeInterval: delay)
}
post(.leftMouseUp, end)
`;
    await runSwift(source);
}

async function dragWin(start, end, durationMs) {
    const startPoint = dipPointToPlatformPoint(start.x, start.y);
    const endPoint = dipPointToPlatformPoint(end.x, end.y);
    const steps = Math.max(2, Math.min(60, Math.round(durationMs / 16)));
    const stepDelay = Math.max(1, Math.round(durationMs / steps));
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class NativeMouse {
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);
}
"@
$startX = ${startPoint.x}
$startY = ${startPoint.y}
$endX = ${endPoint.x}
$endY = ${endPoint.y}
$steps = ${steps}
[NativeMouse]::SetCursorPos($startX, $startY) | Out-Null
[NativeMouse]::mouse_event(0x0002, 0, 0, 0, 0)
for ($i = 1; $i -le $steps; $i++) {
  $x = [Math]::Round($startX + (($endX - $startX) * $i / $steps))
  $y = [Math]::Round($startY + (($endY - $startY) * $i / $steps))
  [NativeMouse]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds ${stepDelay}
}
[NativeMouse]::mouse_event(0x0004, 0, 0, 0, 0)
`;
    await runPowerShell(script);
}

export async function dragTo(args = {}) {
    const startCoords = resolvePointerCoordinates(args);
    const endCoords = resolvePointerCoordinates(args, { xKey: "to_x", yKey: "to_y" });
    const start = resolveGlobalPoint(startCoords.x, startCoords.y);
    const end = resolveGlobalPoint(endCoords.x, endCoords.y);
    const durationMs = normalizeDurationMs(args.duration_ms, 500, {
        min: 1,
        max: 10000,
        label: "duration_ms",
    });
    if (args?.signal?.aborted) {
        throw Object.assign(new Error("Aborted"), { name: "AbortError" });
    }
    if (process.platform === "darwin") {
        await dragMac(start, end, durationMs);
    } else if (process.platform === "win32") {
        await dragWin(start, end, durationMs);
    } else {
        throw new Error("Computer use is supported only on macOS and Windows");
    }
    return `Dragged from (${start.x}, ${start.y}) to (${end.x}, ${end.y})`;
}

async function typeTextMac(text, clearFirst = false, signal) {
    const value = String(text ?? "");
    if (clearFirst) {
        await runOsascript(
            'tell application "System Events" to keystroke "a" using command down',
            signal,
        );
        await runOsascript('tell application "System Events" to key code 51', signal);
    }
    if (!value) {
        return;
    }
    const chunkSize = 400;
    for (let index = 0; index < value.length; index += chunkSize) {
        const chunk = escapeAppleScriptString(value.slice(index, index + chunkSize));
        await runOsascript(`tell application "System Events" to keystroke "${chunk}"`, signal);
    }
}

async function typeTextWin(text, clearFirst = false) {
    const value = String(text ?? "");
    if (clearFirst) {
        await runPowerShell(
            "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^a{BACKSPACE}')",
        );
    }
    if (!value) {
        return;
    }
    const escaped = value.replace(/[+^%~{}[\]()]/g, "{$&}");
    await runPowerShell(
        `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escapePowerShellSingleQuoted(escaped)}')`,
    );
}

export async function typeText({ text, clear_first: clearFirst = false, signal } = {}) {
    if (process.platform === "darwin") {
        await typeTextMac(text, clearFirst, signal);
    } else if (process.platform === "win32") {
        await typeTextWin(text, clearFirst);
    } else {
        throw new Error("Computer use is supported only on macOS and Windows");
    }
    const preview = String(text ?? "").slice(0, 80);
    return preview ? `Typed text: ${preview}${String(text ?? "").length > 80 ? "…" : ""}` : "Typed empty text";
}

const MAC_KEY_CODES = {
    enter: 36,
    return: 36,
    tab: 48,
    escape: 53,
    esc: 53,
    space: 49,
    delete: 51,
    backspace: 51,
    forward_delete: 117,
    up: 126,
    down: 125,
    left: 123,
    right: 124,
    page_up: 116,
    page_down: 121,
    home: 115,
    end: 119,
};

function parseKeyChord(rawKey) {
    const parts = String(rawKey || "")
        .trim()
        .toLowerCase()
        .split("+")
        .map((part) => part.trim())
        .filter(Boolean);
    if (!parts.length) {
        throw new Error("key is required");
    }
    const key = parts.pop();
    return { modifiers: parts, key };
}

function macModifierFlags(modifiers) {
    const flags = [];
    for (const modifier of modifiers) {
        if (modifier === "cmd" || modifier === "command" || modifier === "meta") {
            flags.push("command down");
        } else if (modifier === "ctrl" || modifier === "control") {
            flags.push("control down");
        } else if (modifier === "alt" || modifier === "option") {
            flags.push("option down");
        } else if (modifier === "shift") {
            flags.push("shift down");
        } else {
            throw new Error(`Unknown modifier: ${modifier}`);
        }
    }
    return flags;
}

async function pressKeyMac(rawKey, signal) {
    const { modifiers, key } = parseKeyChord(rawKey);
    const flags = macModifierFlags(modifiers);
    const usingClause = flags.length ? ` using {${flags.join(", ")}}` : "";
    if (MAC_KEY_CODES[key] != null) {
        await runOsascript(
            `tell application "System Events" to key code ${MAC_KEY_CODES[key]}${usingClause}`,
            signal,
        );
        return;
    }
    if (key.length !== 1) {
        throw new Error(`Unsupported key: ${key}`);
    }
    await runOsascript(
        `tell application "System Events" to keystroke "${escapeAppleScriptString(key)}"${usingClause}`,
        signal,
    );
}

async function pressKeyWin(rawKey) {
    const { modifiers, key } = parseKeyChord(rawKey);
    let prefix = "";
    for (const modifier of modifiers) {
        if (modifier === "cmd" || modifier === "command" || modifier === "meta") {
            prefix += "^";
        } else if (modifier === "ctrl" || modifier === "control") {
            prefix += "^";
        } else if (modifier === "alt" || modifier === "option") {
            prefix += "%";
        } else if (modifier === "shift") {
            prefix += "+";
        } else {
            throw new Error(`Unknown modifier: ${modifier}`);
        }
    }
    const special = {
        enter: "{ENTER}",
        return: "{ENTER}",
        tab: "{TAB}",
        escape: "{ESC}",
        esc: "{ESC}",
        space: " ",
        delete: "{DELETE}",
        backspace: "{BACKSPACE}",
        up: "{UP}",
        down: "{DOWN}",
        left: "{LEFT}",
        right: "{RIGHT}",
        page_up: "{PGUP}",
        page_down: "{PGDN}",
        home: "{HOME}",
        end: "{END}",
    };
    const token = special[key] ?? (key.length === 1 ? key : `{${key.toUpperCase()}}`);
    const escaped = `${prefix}${token}`.replace(/[+^%~{}[\]()]/g, "{$&}");
    await runPowerShell(
        `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escapePowerShellSingleQuoted(escaped)}')`,
    );
}

export async function pressKey({ key, signal } = {}) {
    if (process.platform === "darwin") {
        await pressKeyMac(key, signal);
    } else if (process.platform === "win32") {
        await pressKeyWin(key);
    } else {
        throw new Error("Computer use is supported only on macOS and Windows");
    }
    return `Pressed key: ${key}`;
}

function scrollWheelDeltas(direction, amount) {
    const clicks = Math.max(1, Math.min(20, Math.round(Number(amount) || 3)));
    const sign = direction === "up" || direction === "left" ? 1 : -1;
    if (direction === "left" || direction === "right") {
        return { wheel1: 0, wheel2: sign * clicks, wheelCount: 2 };
    }
    return { wheel1: sign * clicks, wheel2: 0, wheelCount: 1 };
}

async function scrollMac(direction, amount) {
    const { wheel1, wheel2, wheelCount } = scrollWheelDeltas(direction, amount);
    const source = `
import CoreGraphics
if let event = CGEvent(
    scrollWheelEvent2Source: nil,
    units: .line,
    wheelCount: ${wheelCount},
    wheel1: ${wheel1},
    wheel2: ${wheel2},
    wheel3: 0
) {
    event.post(tap: .cghidEventTap)
}
`;
    await runSwift(source);
}

async function scrollWin(direction, amount) {
    const clicks = Math.max(1, Math.min(20, Math.round(Number(amount) || 3)));
    const vertical = direction === "up" || direction === "down";
    const delta = direction === "up" || direction === "left" ? 120 : -120;
    const flag = vertical ? "0x0800" : "0x1000";
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class NativeMouse {
  [DllImport("user32.dll")]
  public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);
}
"@
for ($i = 0; $i -lt ${clicks}; $i++) {
  [NativeMouse]::mouse_event(${flag}, 0, 0, ${delta}, 0)
}
`;
    await runPowerShell(script);
}

export async function openApp({ app, signal } = {}) {
    const name = String(app ?? "").trim();
    if (!name) {
        throw new Error("app is required");
    }
    if (signal?.aborted) {
        throw Object.assign(new Error("Aborted"), { name: "AbortError" });
    }
    if (process.platform === "darwin") {
        await execFileAsync("/usr/bin/open", ["-a", name], signal ? { signal } : {});
    } else if (process.platform === "win32") {
        await execFileAsync(
            "cmd",
            ["/c", "start", "", name],
            signal ? { signal } : {},
        );
    } else {
        throw new Error("Computer use is supported only on macOS and Windows");
    }
    return `Opened app: ${name}`;
}

export async function scroll({ direction = "down", amount = 3, at, signal } = {}) {
    const normalized = String(direction || "down").toLowerCase();
    if (!["up", "down", "left", "right"].includes(normalized)) {
        throw new Error("direction must be up, down, left, or right");
    }
    if (at != null && at.x != null && at.y != null) {
        await moveTo({ x: at.x, y: at.y, signal });
    }
    if (process.platform === "darwin") {
        await scrollMac(normalized, amount);
    } else if (process.platform === "win32") {
        await scrollWin(normalized, amount);
    } else {
        throw new Error("Computer use is supported only on macOS and Windows");
    }
    return `Scrolled ${normalized} (${amount} wheel lines)`;
}
