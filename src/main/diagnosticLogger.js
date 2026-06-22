import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stripInlineImagePayloads } from "@shared/imagePayloads.js";

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_PATTERN = /api[_-]?key|authorization|token|secret|password|cookie/i;

function defaultLogDir() {
    return path.join(os.homedir(), ".CRAgent", "Log");
}

function logFileName(date = new Date()) {
    return `cragent-${date.toISOString().slice(0, 10)}.log`;
}

export function redactForDiagnosticLog(value) {
    if (typeof value === "string") {
        return stripInlineImagePayloads(value);
    }
    if (Array.isArray(value)) {
        return value.map((item) => redactForDiagnosticLog(item));
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                key,
                SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactForDiagnosticLog(item),
            ]),
        );
    }
    return value;
}

export function createDiagnosticLogger(logDir = defaultLogDir()) {
    fs.mkdirSync(logDir, { recursive: true });

    async function write(level, event, fields = {}) {
        const entry = redactForDiagnosticLog({
            timestamp: new Date().toISOString(),
            level,
            event,
            ...fields,
        });
        const filePath = path.join(logDir, logFileName());
        try {
            await fsPromises.mkdir(logDir, { recursive: true });
            await fsPromises.appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf-8");
        } catch (error) {
            console.warn("[CRAgent][Log] failed to write diagnostic log:", error);
        }
    }

    return {
        dir: logDir,
        info: (event, fields) => write("info", event, fields),
        warn: (event, fields) => write("warn", event, fields),
        error: (event, fields) => write("error", event, fields),
    };
}
