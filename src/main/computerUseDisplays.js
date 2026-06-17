/** @typedef {{ x: number, y: number, width: number, height: number }} Rect */

let screenGetter = null;

/** Test hook: inject Electron screen module or mock. */
export function setComputerUseScreenGetter(getter) {
    screenGetter = getter;
}

function getScreenModule() {
    if (screenGetter) {
        return screenGetter;
    }
    try {
        // Lazy require keeps unit tests runnable without Electron.
        // eslint-disable-next-line no-undef
        const { screen } = require("electron");
        return screen;
    } catch {
        return null;
    }
}

function computeVirtualBounds(boundsList) {
    if (!boundsList.length) {
        return { x: 0, y: 0, width: 0, height: 0 };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const bounds of boundsList) {
        minX = Math.min(minX, bounds.x);
        minY = Math.min(minY, bounds.y);
        maxX = Math.max(maxX, bounds.x + bounds.width);
        maxY = Math.max(maxY, bounds.y + bounds.height);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function getDisplayLayout() {
    const screen = getScreenModule();
    if (!screen) {
        return {
            coordinateSystem: "global_dip",
            virtualBounds: { x: 0, y: 0, width: 1920, height: 1080 },
            primaryDisplayIndex: 0,
            displays: [
                {
                    index: 0,
                    id: 0,
                    label: "primary",
                    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
                    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
                    scaleFactor: 1,
                    isPrimary: true,
                },
            ],
        };
    }

    const allDisplays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const displays = allDisplays.map((display, index) => ({
        index,
        id: display.id,
        label: display.label || `Display ${index + 1}`,
        bounds: { ...display.bounds },
        workArea: { ...display.workArea },
        scaleFactor: display.scaleFactor,
        isPrimary: display.id === primary.id,
    }));

    return {
        coordinateSystem: "global_dip",
        virtualBounds: computeVirtualBounds(displays.map((entry) => entry.bounds)),
        primaryDisplayIndex: Math.max(
            0,
            displays.findIndex((entry) => entry.isPrimary),
        ),
        displays,
    };
}

export function resolveDisplayTarget(displayArg) {
    const layout = getDisplayLayout();
    const raw = displayArg == null ? "main" : displayArg;

    if (raw === "all") {
        return { mode: "all", layout };
    }
    if (raw === "main") {
        const display =
            layout.displays.find((entry) => entry.isPrimary) || layout.displays[0];
        if (!display) {
            throw new Error("No displays detected");
        }
        return { mode: "single", display, layout };
    }

    const index = Number(raw);
    if (Number.isInteger(index) && index >= 0 && index < layout.displays.length) {
        return { mode: "single", display: layout.displays[index], layout };
    }

    throw new Error(
        `Unknown display "${displayArg}". Use main, all, or index 0-${layout.displays.length - 1}.`,
    );
}

function formatCoordinateForError(value) {
    if (typeof value === "number" && Number.isNaN(value)) {
        return "missing or invalid";
    }
    if (value === undefined) {
        return "undefined";
    }
    if (value === null) {
        return "null";
    }
    if (typeof value === "object") {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
    return `${JSON.stringify(value)} (${typeof value})`;
}

export function coerceCoordinate(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) {
            return NaN;
        }
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : NaN;
    }
    return NaN;
}

function pointerAliasesForKeys(xKey, yKey) {
    if (xKey === "x" && yKey === "y") {
        return ["coordinate", "coordinates", "point", "position", "start"];
    }
    if (xKey === "to_x" && yKey === "to_y") {
        return ["to_coordinate", "to_coordinates", "to_point", "to_position", "destination", "end"];
    }
    return [];
}

function coordinatesFromAliasValue(value) {
    if (Array.isArray(value) && value.length >= 2) {
        const x = coerceCoordinate(value[0]);
        const y = coerceCoordinate(value[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) {
            return { x, y };
        }
    }
    if (value && typeof value === "object") {
        const x = coerceCoordinate(value.x ?? value.X);
        const y = coerceCoordinate(value.y ?? value.Y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
            return { x, y };
        }
    }
    return null;
}

/** Normalize x/y from tool args, including common alternate coordinate shapes from vision models. */
export function resolvePointerCoordinates(args = {}, { xKey = "x", yKey = "y" } = {}) {
    let x = coerceCoordinate(args[xKey]);
    let y = coerceCoordinate(args[yKey]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
        return { x, y };
    }

    for (const alias of pointerAliasesForKeys(xKey, yKey)) {
        const fromAlias = coordinatesFromAliasValue(args[alias]);
        if (!fromAlias) {
            continue;
        }
        if (!Number.isFinite(x)) {
            x = fromAlias.x;
        }
        if (!Number.isFinite(y)) {
            y = fromAlias.y;
        }
        if (Number.isFinite(x) && Number.isFinite(y)) {
            return { x, y };
        }
    }

    return { x, y };
}

export function resolveGlobalPoint(x, y) {
    const px = coerceCoordinate(x);
    const py = coerceCoordinate(y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
        throw new Error(
            `x and y must be finite numbers (received x=${formatCoordinateForError(x)}, y=${formatCoordinateForError(y)}). ` +
                "Use global DIP pixels from computer_displays, or pass coordinate: [x, y].",
        );
    }

    const layout = getDisplayLayout();
    const point = { x: Math.round(px), y: Math.round(py) };
    const display =
        layout.displays.find(
            (entry) =>
                point.x >= entry.bounds.x &&
                point.x < entry.bounds.x + entry.bounds.width &&
                point.y >= entry.bounds.y &&
                point.y < entry.bounds.y + entry.bounds.height,
        ) ?? null;

    return {
        ...point,
        displayIndex: display?.index ?? null,
        display,
        layout,
    };
}

export function dipPointToPlatformPoint(x, y) {
    const screen = getScreenModule();
    const rounded = { x: Math.round(Number(x)), y: Math.round(Number(y)) };
    if (!screen?.dipToScreenPoint) {
        return rounded;
    }
    return screen.dipToScreenPoint(rounded);
}

/** macOS screencapture -R expects x,y,width,height (see man screencapture). */
export function formatMacScreencaptureRegion(rect) {
    return `${rect.x},${rect.y},${rect.width},${rect.height}`;
}

/** @param {Rect} bounds */
export function dipRectToPlatformRect(bounds) {
    const screen = getScreenModule();
    if (!screen?.dipToScreenPoint) {
        return {
            x: Math.round(bounds.x),
            y: Math.round(bounds.y),
            width: Math.round(bounds.width),
            height: Math.round(bounds.height),
        };
    }
    const topLeft = screen.dipToScreenPoint({ x: bounds.x, y: bounds.y });
    const bottomRight = screen.dipToScreenPoint({
        x: bounds.x + bounds.width,
        y: bounds.y + bounds.height,
    });
    return {
        x: topLeft.x,
        y: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
    };
}

export function formatDisplayLayoutForPrompt(layout = getDisplayLayout()) {
    const lines = [
        `Coordinate system: global ${layout.coordinateSystem} (origin at top-left of virtual desktop)`,
        `Virtual desktop: x=${layout.virtualBounds.x} y=${layout.virtualBounds.y} ${layout.virtualBounds.width}x${layout.virtualBounds.height}`,
        "Displays:",
    ];
    for (const display of layout.displays) {
        const bounds = display.bounds;
        lines.push(
            `- [${display.index}] ${display.label}${display.isPrimary ? " (primary)" : ""}: x=${bounds.x} y=${bounds.y} ${bounds.width}x${bounds.height} scale=${display.scaleFactor}`,
        );
    }
    return lines.join("\n");
}
