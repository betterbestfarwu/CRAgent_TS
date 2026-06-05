import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, nextResolve) {
    if (specifier === "electron") {
        return nextResolve(pathToFileURL(path.join(root, "test/electron-stub.mjs")).href, context);
    }
    if (specifier.startsWith("@shared/")) {
        const subpath = specifier.slice("@shared/".length);
        const file = subpath.endsWith(".js") ? subpath : `${subpath}.js`;
        const target = path.join(root, "src/shared", file);
        return nextResolve(pathToFileURL(target).href, context);
    }
    return nextResolve(specifier, context);
}
