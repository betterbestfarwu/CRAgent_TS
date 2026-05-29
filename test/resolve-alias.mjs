import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@shared/")) {
        const subpath = specifier.slice("@shared/".length);
        const target = path.join(root, "src/shared", `${subpath}.js`);
        return nextResolve(pathToFileURL(target).href, context);
    }
    return nextResolve(specifier, context);
}
