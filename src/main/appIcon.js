import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, nativeImage } from "electron";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export function resolveAppIconPath() {
    const dirs = [
        path.join(moduleDir, "../../build"),
        path.join(moduleDir, "../../public"),
        path.join(process.cwd(), "build"),
        path.join(process.cwd(), "public"),
    ];
    const names =
        process.platform === "darwin"
            ? ["icon.icns", "icon.png"]
            : process.platform === "win32"
              ? ["icon.ico", "icon.png"]
              : ["icon.png", "icon.icns"];
    for (const dir of dirs) {
        for (const name of names) {
            const candidate = path.join(dir, name);
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
    }
    return undefined;
}

export function loadAppIcon() {
    const iconPath = resolveAppIconPath();
    if (!iconPath) {
        return undefined;
    }
    const image = nativeImage.createFromPath(iconPath);
    return image.isEmpty() ? undefined : image;
}

export function applyAppIcon() {
    const image = loadAppIcon();
    if (!image) {
        return undefined;
    }
    if (process.platform === "darwin" && app.dock) {
        app.dock.setIcon(image);
    }
    return image;
}
