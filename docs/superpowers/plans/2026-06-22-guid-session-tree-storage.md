# GUID Session Tree Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move plain and project session storage into stable GUID top-level roots under `~/.CRAgent/sessions`.

**Architecture:** Add a focused shared path helper for layout metadata and derived roots, then route `SessionStore` through those helpers. Existing per-session APIs keep accepting a "sessionsDir" base, but that base becomes either `<sessionsRootGuid>` or `<projectsRootGuid>/<projectId>`.

**Tech Stack:** Electron main process, Node.js `fs/path/crypto`, Node test runner.

---

## File Structure

- Create `src/shared/sessionTreeStoragePaths.js`: layout metadata, GUID root creation, root path helpers, and legacy project root helper.
- Modify `src/main/sessionStore.js`: initialize layout, create/migrate root directories, locate sessions in new hierarchy, and remove projects from the new project tree.
- Modify `src/main/sessionStorage.js`: skip reserved underscore directories while scanning session entries.
- Modify `src/main/agentRuntime.js`: update user-facing storage prompt text.
- Modify `src/shared/sessionStoragePaths.js`: update goal-mode warning text.
- Modify `test/sessionStoreProjects.test.js`: assert new project-session hierarchy and legacy migration.
- Create `test/sessionTreeStoragePaths.test.js`: assert stable GUID metadata and helper paths.
- Modify `test/sessionStorage.test.js`: assert reserved layout directories are ignored.

### Task 1: Path Helper

**Files:**
- Create: `src/shared/sessionTreeStoragePaths.js`
- Test: `test/sessionTreeStoragePaths.test.js`

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    ensureSessionTreeLayout,
    sessionTreeLayoutFile,
    standaloneSessionsDir,
    projectTreeRootDir,
    projectSessionsDir,
    legacyProjectsStorageRoot,
} from "../src/shared/sessionTreeStoragePaths.js";

describe("sessionTreeStoragePaths", () => {
    it("creates stable GUID roots under sessions", () => {
        const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-tree-paths-"));
        const layout = ensureSessionTreeLayout(sessionsDir);
        assert.match(layout.sessionsRootId, /^[0-9a-f-]{36}$/i);
        assert.match(layout.projectsRootId, /^[0-9a-f-]{36}$/i);
        assert.notEqual(layout.sessionsRootId, layout.projectsRootId);
        assert.equal(fs.existsSync(sessionTreeLayoutFile(sessionsDir)), true);
        assert.equal(ensureSessionTreeLayout(sessionsDir).sessionsRootId, layout.sessionsRootId);
        assert.equal(ensureSessionTreeLayout(sessionsDir).projectsRootId, layout.projectsRootId);
    });

    it("derives standalone and project hierarchy paths", () => {
        const sessionsDir = "/data/.CRAgent/sessions";
        const layout = { sessionsRootId: "sessions-root", projectsRootId: "projects-root" };
        assert.equal(standaloneSessionsDir(sessionsDir, layout), path.join(sessionsDir, "sessions-root"));
        assert.equal(projectTreeRootDir(sessionsDir, layout), path.join(sessionsDir, "projects-root"));
        assert.equal(projectSessionsDir(sessionsDir, layout, "project-a"), path.join(sessionsDir, "projects-root", "project-a"));
        assert.equal(legacyProjectsStorageRoot(sessionsDir), path.join("/data/.CRAgent", "Projects"));
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/sessionTreeStoragePaths.test.js`

Expected: FAIL because `src/shared/sessionTreeStoragePaths.js` does not exist.

- [ ] **Step 3: Implement the helper**

```js
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const SESSION_TREE_LAYOUT_DIR = "_layout";
export const SESSION_TREE_LAYOUT_FILENAME = "tree.json";

export function sessionTreeLayoutFile(sessionsDir) {
    return path.join(sessionsDir, SESSION_TREE_LAYOUT_DIR, SESSION_TREE_LAYOUT_FILENAME);
}

export function normalizeLayoutId(value) {
    const id = String(value || "").trim();
    return id || null;
}

export function ensureSessionTreeLayout(sessionsDir) {
    fs.mkdirSync(sessionsDir, { recursive: true });
    const file = sessionTreeLayoutFile(sessionsDir);
    let parsed = {};
    if (fs.existsSync(file)) {
        try {
            parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
        } catch {
            parsed = {};
        }
    }
    let sessionsRootId = normalizeLayoutId(parsed.sessionsRootId);
    let projectsRootId = normalizeLayoutId(parsed.projectsRootId);
    if (!sessionsRootId) {
        sessionsRootId = randomUUID();
    }
    if (!projectsRootId || projectsRootId === sessionsRootId) {
        projectsRootId = randomUUID();
    }
    const layout = { sessionsRootId, projectsRootId };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(layout, null, 2), { encoding: "utf-8", mode: 0o644 });
    return layout;
}

export function standaloneSessionsDir(sessionsDir, layout) {
    return path.join(sessionsDir, layout.sessionsRootId);
}

export function projectTreeRootDir(sessionsDir, layout) {
    return path.join(sessionsDir, layout.projectsRootId);
}

export function projectSessionsDir(sessionsDir, layout, projectId) {
    return path.join(projectTreeRootDir(sessionsDir, layout), String(projectId || "").trim());
}

export function legacyProjectsStorageRoot(sessionsDir) {
    return path.join(path.dirname(sessionsDir), "Projects");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/sessionTreeStoragePaths.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/sessionTreeStoragePaths.js test/sessionTreeStoragePaths.test.js
git commit -m "feat: add session tree storage paths"
```

### Task 2: Session Store New Layout and Migration

**Files:**
- Modify: `src/main/sessionStore.js`
- Modify: `test/sessionStoreProjects.test.js`

- [ ] **Step 1: Write the failing tests**

Add tests that create a store with `sessionsDir` and `projectsFile`, then assert:

```js
const layout = store.sessionTreeLayout;
assert.equal(fs.existsSync(sessionDir(path.join(sessionsDir, layout.sessionsRootId), globalSession.meta.id)), true);
assert.equal(fs.existsSync(sessionDir(path.join(sessionsDir, layout.projectsRootId, project.id), projectSession.meta.id)), true);
```

Add migration coverage:

```js
const legacyProjectRoot = path.join(dir, "Projects", "pending-project-id", "sessions");
writeMeta(legacyProjectRoot, { id: "legacy-project-session", projectId: "pending-project-id", title: "新会话", providerKey: "openai", modelId: "gpt-4o-mini", createdAt: timestamp, updatedAt: timestamp, todos: [] });
const migratedStore = new SessionStore(sessionsDir, model, projectsFile);
const layout = migratedStore.sessionTreeLayout;
assert.equal(fs.existsSync(sessionDir(legacyProjectRoot, "legacy-project-session")), false);
assert.equal(fs.existsSync(sessionDir(path.join(sessionsDir, layout.projectsRootId, "pending-project-id"), "legacy-project-session")), true);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/sessionStoreProjects.test.js`

Expected: FAIL because project sessions still use `Projects/<projectId>/sessions`.

- [ ] **Step 3: Implement store routing and migration**

Update imports to use `sessionTreeStoragePaths.js`. In the constructor, set `this.sessionTreeLayout = ensureSessionTreeLayout(this.sessionsDir)`. Set `this.projectsDir` to `projectTreeRootDir(this.sessionsDir, this.sessionTreeLayout)` unless an explicit test override is passed.

Change:

```js
projectSessionsDir(projectId) {
    return projectSessionsDir(this.sessionsDir, this.sessionTreeLayout, projectId);
}

resolveSessionsDirForNew(projectId) {
    const normalized = normalizeProjectId(projectId);
    if (normalized) {
        this.ensureProjectLayout(normalized);
        return this.projectSessionsDir(normalized);
    }
    const dir = standaloneSessionsDir(this.sessionsDir, this.sessionTreeLayout);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
```

Update `locateSessionStorage` to search standalone root first, then each project root, then legacy roots for migration compatibility. Update `migrateGlobalProjectSessions` to move direct legacy project sessions into `projectSessionsDir(projectId)`. Add a `migrateLegacyProjectTreeSessions()` pass that scans `legacyProjectsStorageRoot(this.sessionsDir)` and moves each known project's `sessions` children into `projectSessionsDir(project.id)`.

Keep `projects.json` as metadata only; project directory deletion removes `projectSessionsDir(projectId)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/sessionStoreProjects.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/sessionStore.js test/sessionStoreProjects.test.js
git commit -m "feat: store project sessions under guid tree"
```

### Task 3: Plain Session Migration and Reserved Directory Scanning

**Files:**
- Modify: `src/main/sessionStore.js`
- Modify: `src/main/sessionStorage.js`
- Modify: `test/sessionStorage.test.js`

- [ ] **Step 1: Write the failing tests**

Add a plain legacy migration test:

```js
writeMeta(sessionsDir, { id: "legacy-plain", projectId: null, title: "新会话", providerKey: "openai", modelId: "gpt-4o-mini", createdAt: timestamp, updatedAt: timestamp, todos: [] });
const store = new SessionStore(sessionsDir, model, projectsFile);
const layout = store.sessionTreeLayout;
assert.equal(fs.existsSync(sessionDir(sessionsDir, "legacy-plain")), false);
assert.equal(fs.existsSync(sessionDir(path.join(sessionsDir, layout.sessionsRootId), "legacy-plain")), true);
```

Add a scanning test:

```js
fs.mkdirSync(path.join(sessionsDir, "_layout"), { recursive: true });
fs.writeFileSync(path.join(sessionsDir, "_layout", "tree.json"), "{}", "utf-8");
assert.deepEqual(listSessionEntries(sessionsDir), []);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/sessionStorage.test.js test/sessionStoreProjects.test.js`

Expected: FAIL because direct plain sessions are not migrated into the GUID root yet or reserved directories are not explicitly skipped.

- [ ] **Step 3: Implement migration and scanner guard**

Add `migrateStandaloneSessions()` to move direct non-project session entries from `this.sessionsDir` into `standaloneSessionsDir(this.sessionsDir, this.sessionTreeLayout)`. In `listSessionEntries`, skip any directory whose name starts with `_` so `_layout` and future reserved directories never appear as sessions.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/sessionStorage.test.js test/sessionStoreProjects.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/sessionStore.js src/main/sessionStorage.js test/sessionStorage.test.js test/sessionStoreProjects.test.js
git commit -m "feat: migrate standalone sessions to guid root"
```

### Task 4: Generated File Paths and Prompt Text

**Files:**
- Modify: `src/shared/sessionStoragePaths.js`
- Modify: `src/main/agentRuntime.js`
- Modify: `test/sessionStoragePaths.test.js`

- [ ] **Step 1: Write or update the failing tests**

Update existing expectations so redirected generated files target the new project hierarchy:

```js
const sessionsDir = path.join(dir, "sessions", "projects-root", "p1");
assert.equal(path.join(sessionsDir, sessionId, "tasks", "out.md"), target);
```

Add a warning text assertion:

```js
assert.match(goalModeBashBlocksWorkspaceCragent("echo hi > .cragent/out.txt"), /~\/\.CRAgent\/sessions\/<projectsRootGuid>\/<projectId>\/<sessionId>/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/sessionStoragePaths.test.js`

Expected: FAIL because the warning text still mentions `Projects/<projectId>/sessions/<sessionId>`.

- [ ] **Step 3: Update text and keep path behavior**

Change user-facing text in `goalModeBashBlocksWorkspaceCragent` and `AgentRuntime.buildSystemPromptContent` to describe `~/.CRAgent/sessions/<sessionsRootGuid>/<sessionId>/` for plain sessions and `~/.CRAgent/sessions/<projectsRootGuid>/<projectId>/<sessionId>/` for project sessions. Do not change `resolveSessionStorageToolPath`; it already works with the located `sessionsDir`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/sessionStoragePaths.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/sessionStoragePaths.js src/main/agentRuntime.js test/sessionStoragePaths.test.js
git commit -m "chore: update session storage path messaging"
```

### Task 5: Full Verification

**Files:**
- No source changes expected unless verification exposes a bug.

- [ ] **Step 1: Run focused tests**

Run: `npm test -- test/sessionTreeStoragePaths.test.js test/sessionStoreProjects.test.js test/sessionStorage.test.js test/sessionStoragePaths.test.js`

Expected: PASS.

- [ ] **Step 2: Run broader storage-adjacent tests**

Run: `npm test -- test/planMode.test.js test/toolResultStorage.test.js test/sessionImageStorage.test.js test/agentIntegration.test.js`

Expected: PASS.

- [ ] **Step 3: Inspect git status**

Run: `git status --short`

Expected: only the pre-existing untracked `AGENTS.md`, or no changes if it becomes tracked by the user.
