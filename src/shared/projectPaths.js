/**
 * @param {string} projectDirectoryPath
 * @param {string} relativePath
 */
export function resolveProjectFilePath(projectDirectoryPath, relativePath) {
    const base = String(projectDirectoryPath ?? "").trim().replace(/\/+$/, "");
    const rel = String(relativePath ?? "").trim().replace(/^\/+/, "");
    if (!base || !rel) return "";
    return `${base}/${rel}`;
}
