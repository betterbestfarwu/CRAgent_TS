import path from "node:path";
import { expandTilde } from "./workspacePaths.js";

/**
 * Expand `@relative/path` mentions to absolute paths under the project root.
 * @param {string} text
 * @param {string | null | undefined} projectRoot
 * @returns {string}
 */
export function expandAtMentionsToAbsolute(text, projectRoot) {
    const root = String(projectRoot ?? "").trim();
    if (!root) {
        return String(text ?? "");
    }
    const resolvedRoot = path.resolve(expandTilde(root));
    return String(text ?? "").replace(/@([^\s@]+)/g, (full, mentionPath) => {
        const raw = String(mentionPath ?? "").trim();
        if (!raw || path.isAbsolute(raw)) {
            return full;
        }
        return `@${path.resolve(resolvedRoot, raw)}`;
    });
}
