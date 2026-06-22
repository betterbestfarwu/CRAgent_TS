import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDiagnosticLogger } from "../src/main/diagnosticLogger.js";

test("diagnostic logger writes JSONL entries under the configured Log directory", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-log-test-"));
    const logDir = path.join(dir, ".CRAgent", "Log");
    const logger = createDiagnosticLogger(logDir);

    await logger.info("agent.test", {
        sessionId: "session-1",
        apiKey: "secret-key",
        nested: { Authorization: "Bearer secret" },
    });

    const files = fs.readdirSync(logDir);
    assert.equal(files.length, 1);
    assert.match(files[0], /^cragent-\d{4}-\d{2}-\d{2}\.log$/);

    const line = fs.readFileSync(path.join(logDir, files[0]), "utf-8").trim();
    const parsed = JSON.parse(line);
    assert.equal(parsed.level, "info");
    assert.equal(parsed.event, "agent.test");
    assert.equal(parsed.sessionId, "session-1");
    assert.equal(parsed.apiKey, "[REDACTED]");
    assert.equal(parsed.nested.Authorization, "[REDACTED]");
    assert.ok(parsed.timestamp);
});
