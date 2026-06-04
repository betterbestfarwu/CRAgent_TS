import { app } from "electron";

/**
 * @param {string[]} paths
 * @returns {Promise<Record<string, string>>}
 */
export async function getFileIconsAsDataUrls(paths) {
    const unique = [...new Set(paths.filter((p) => typeof p === "string" && p.trim()))];
    const results = {};

    await Promise.all(
        unique.map(async (filePath) => {
            try {
                const image = await app.getFileIcon(filePath, { size: "small" });
                if (image.isEmpty()) return;
                const dataUrl = image.toDataURL();
                if (dataUrl) results[filePath] = dataUrl;
            } catch {
                // ignore unreadable paths
            }
        }),
    );

    return results;
}
