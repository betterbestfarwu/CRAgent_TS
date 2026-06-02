import fs from "node:fs";

const META_READ_BYTES = 32768;

/** Parse only session.meta without loading messages (avoids large embedded images). */
export function readSessionMetaFromFile(filePath) {
    const fd = fs.openSync(filePath, "r");
    try {
        const buf = Buffer.alloc(META_READ_BYTES);
        const bytesRead = fs.readSync(fd, buf, 0, META_READ_BYTES, 0);
        const prefix = buf.toString("utf-8", 0, bytesRead);
        const meta = parseMetaPrefix(prefix);
        if (meta) {
            return meta;
        }
    } finally {
        fs.closeSync(fd);
    }

    return parseMetaPrefix(fs.readFileSync(filePath, "utf-8"));
}

function parseMetaPrefix(raw) {
    const metaIndex = raw.indexOf('"meta"');
    if (metaIndex < 0) {
        throw new Error("Invalid session file: missing meta");
    }

    const objectStart = raw.indexOf("{", metaIndex + '"meta"'.length);
    if (objectStart < 0) {
        throw new Error("Invalid session file: missing meta object");
    }

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = objectStart; i < raw.length; i += 1) {
        const char = raw[i];
        if (inString) {
            if (escape) {
                escape = false;
            } else if (char === "\\") {
                escape = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === "{") {
            depth += 1;
            continue;
        }
        if (char === "}") {
            depth -= 1;
            if (depth === 0) {
                return JSON.parse(raw.slice(objectStart, i + 1));
            }
        }
    }

    return null;
}
