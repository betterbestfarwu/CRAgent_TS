import fs from "node:fs/promises";
import path from "node:path";
import { sortDirectoryEntries } from "@shared/atMention.js";

const SKIP_DIR_NAMES = new Set([
    "node_modules",
    ".git",
    "dist",
    "out",
    "release",
    "coverage",
    ".turbo",
    ".next",
    "build",
]);

function toPosixRelative(relativePath) {
    return String(relativePath ?? "")
        .replace(/\\/g, "/")
        .replace(/^\/+/, "")
        .replace(/\/+$/, "");
}

function resolveInsideProject(projectRoot, relativePath) {
    const root = path.resolve(projectRoot);
    const rel = toPosixRelative(relativePath);
    const target = rel ? path.resolve(root, rel) : root;
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
        throw new Error("路径超出项目目录");
    }
    return { root, target, relativePath: rel };
}

/**
 * @param {string} projectRoot
 * @param {string} [relativePath]
 */
export async function listProjectDirectory(projectRoot, relativePath = "") {
    const { root, target, relativePath: rel } = resolveInsideProject(projectRoot, relativePath);
    let stat;
    try {
        stat = await fs.stat(target);
    } catch (err) {
        if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
            throw new Error("目录不存在");
        }
        throw err;
    }
    if (!stat.isDirectory()) {
        throw new Error("不是目录");
    }

    const dirents = await fs.readdir(target, { withFileTypes: true });
    const entries = [];
    for (const dirent of dirents) {
        if (dirent.name === "." || dirent.name === "..") continue;
        const isDir = dirent.isDirectory();
        if (isDir && SKIP_DIR_NAMES.has(dirent.name)) continue;
        const childRel = rel ? `${rel}/${dirent.name}` : dirent.name;
        entries.push({
            name: dirent.name,
            kind: isDir ? "dir" : "file",
            relativePath: childRel,
        });
    }

    return {
        relativePath: rel,
        entries: sortDirectoryEntries(entries),
    };
}
