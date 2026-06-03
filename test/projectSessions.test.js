import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    indexSessionsByProjectId,
    normalizeProjectSessions,
    repairProjectRecords,
} from "../src/shared/projectSessions.js";

describe("projectSessions repair", () => {
    it("normalizes and dedupes session entries", () => {
        assert.deepEqual(
            normalizeProjectSessions([
                { sessionId: "b", name: "B" },
                { sessionId: "a", name: "" },
                { sessionId: "b", name: "duplicate" },
            ]),
            [
                { sessionId: "a", name: "新会话" },
                { sessionId: "b", name: "B" },
            ],
        );
    });

    it("backfills sessions from metas and drops stale ids", () => {
        const projects = [
            {
                id: "p1",
                name: "Alpha",
                directoryPath: "/alpha",
                sessions: [{ sessionId: "gone", name: "old" }],
            },
            {
                id: "p2",
                name: "Beta",
                directoryPath: "/beta",
            },
        ];
        const sessionsByProjectId = indexSessionsByProjectId([
            { id: "s1", title: "Chat one", projectId: "p1" },
            { id: "s2", title: "Chat two", projectId: "p2" },
        ]);
        const { projects: repaired, changed } = repairProjectRecords(projects, sessionsByProjectId, {
            now: () => "2026-06-03T12:00:00.000Z",
        });

        assert.equal(changed, true);
        assert.deepEqual(repaired[0].sessions, [{ sessionId: "s1", name: "Chat one" }]);
        assert.deepEqual(repaired[1].sessions, [{ sessionId: "s2", name: "Chat two" }]);
        assert.equal(repaired[0].updatedAt, "2026-06-03T12:00:00.000Z");
    });
});
