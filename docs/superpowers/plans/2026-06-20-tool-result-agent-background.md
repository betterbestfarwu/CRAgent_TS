# Tool Result And Background Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring CRAgent tool-result persistence closer to ClaudeCode behavior and add a lightweight background sub-agent path.

**Architecture:** Extend the existing focused modules instead of adding a new task platform. `toolResultStorage.js` will support text and JSON/text-block persistence. `metaTools.js` and `agentRuntime.js` will keep synchronous `Task` behavior unchanged while adding `run_in_background` and a small `TaskOutput` reader backed by session files.

**Tech Stack:** Node.js, Electron main process modules, `node:test`, existing session storage helpers.

---

### Task 1: Tool Result JSON/Text Block Persistence

**Files:**
- Modify: `test/toolResultStorage.test.js`
- Modify: `src/main/toolResultStorage.js`

- [x] **Step 1: Write failing tests**
  - Add coverage for array text blocks persisted as `.json`.
  - Add coverage that non-text blocks return an error from `persistToolResult`.
  - Add coverage that `maybePersistLargeToolResult` falls back inline when non-text block persistence is rejected.

- [x] **Step 2: Verify RED**
  - Run: `npm test -- test/toolResultStorage.test.js`
  - Expected: new tests fail because `getToolResultPath` always returns `.txt` and persistence stringifies all content.

- [x] **Step 3: Implement minimal storage changes**
  - Add `isJsonToolResultContent`, `normalizeToolResultContent`, and an `isJson` option to `getToolResultPath`.
  - Persist arrays of text blocks as formatted JSON.
  - Reject arrays containing non-text blocks with `{ error: "Cannot persist tool results containing non-text content" }`.
  - Include `isJson` in persisted metadata while preserving existing message format.

- [x] **Step 4: Verify GREEN**
  - Run: `npm test -- test/toolResultStorage.test.js`
  - Expected: all tool result tests pass.

### Task 2: Background Sub-Agent And Output Reader

**Files:**
- Modify: `test/agentIntegration.test.js`
- Modify: `src/main/tools/metaTools.js`
- Modify: `src/main/agentRuntime.js`

- [x] **Step 1: Write failing tests**
  - Assert `Task` schema accepts `run_in_background`.
  - Assert background `Task` returns `async_launched`, `agentId`, and `outputFile`.
  - Assert `TaskOutput` can read pending output, then completed output after the background promise resolves.
  - Assert synchronous `Task` still returns the existing completed message.

- [x] **Step 2: Verify RED**
  - Run: `node --import ./test/register-test.mjs --test test/agentIntegration.test.js`
  - Expected: new tests fail because `run_in_background` and `TaskOutput` do not exist.

- [x] **Step 3: Implement minimal background runtime**
  - Add a `TaskOutput` tool enabled with sub-agents.
  - Add `runSubAgentInBackground` to `AgentRuntime`.
  - Create `sub-agent-outputs/<agentId>.txt` under the session directory.
  - Write a pending marker before launch, then replace it with the final `runSubAgent` result or failure message.
  - Return the output file path so the main agent can poll it.

- [x] **Step 4: Verify GREEN**
  - Run: `node --import ./test/register-test.mjs --test test/agentIntegration.test.js`
  - Expected: all agent integration tests pass.

### Task 3: Final Verification And Commit

**Files:**
- All modified source, tests, and this plan.

- [x] **Step 1: Run targeted tests**
  - Run: `npm test -- test/toolResultStorage.test.js test/agentIntegration.test.js`
  - Expected: pass.

- [x] **Step 2: Inspect git diff**
  - Run: `git diff -- src/main/toolResultStorage.js src/main/tools/metaTools.js src/main/agentRuntime.js test/toolResultStorage.test.js test/agentIntegration.test.js docs/superpowers/plans/2026-06-20-tool-result-agent-background.md`
  - Expected: scoped changes only.

- [ ] **Step 3: Commit**
  - Run: `git add ...`
  - Run: `git commit -m "feat: align tool results and background agents"`
  - Expected: commit succeeds.
