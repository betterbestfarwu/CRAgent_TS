# Computer Use Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a unified `computer_action` interface with drag/wait support and built-in-style computer-use prompting.

**Architecture:** Reuse the existing low-level desktop functions in `src/main/computerUse.js` and expose a new aggregate tool from `src/main/tools/computerUseTools.js`. Keep existing tools stable while updating `/computer` prompt text in `src/shared/chatCommands.js`.

**Tech Stack:** Electron main process, Node.js ESM, native macOS AppleScript/Swift desktop events, Windows PowerShell desktop events, `node:test`.

---

## File Structure

- Modify `src/main/computerUse.js`: add `dragTo`, `waitForComputer`, prompt guidance, and validation helpers.
- Modify `src/main/tools/computerUseTools.js`: register `computer_action` and route actions to low-level functions.
- Modify `src/shared/chatCommands.js`: update `/computer` prompt and help text.
- Modify `test/computerUse.test.js`: cover action registration, wait execution, and low-level validation.
- Modify `test/chatCommands.test.js`: cover updated prompt text.

### Task 1: Computer Action Tests

**Files:**
- Modify: `test/computerUse.test.js`
- Modify: `test/chatCommands.test.js`

- [ ] **Step 1: Add failing registration and wait routing tests**

Add tests that expect `computer_action` to be registered when `enable_computer_use` is true and that `computer_action` with `action: "wait"` returns a wait result without touching OS APIs.

- [ ] **Step 2: Add failing prompt tests**

Update chat command tests so enabled `/computer` prompts mention `computer_action`, screenshot-observe-act-verify flow, and the aggregate action set.

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
node --import ./test/register-test.mjs --test test/computerUse.test.js test/chatCommands.test.js
```

Expected: tests fail because `computer_action` and wait helpers do not exist yet.

### Task 2: Low-Level Drag And Wait

**Files:**
- Modify: `src/main/computerUse.js`
- Modify: `test/computerUse.test.js`

- [ ] **Step 1: Implement `waitForComputer`**

Add an exported async function that clamps wait duration to a safe range and respects abort signals.

- [ ] **Step 2: Implement `dragTo`**

Add an exported async function that moves from one global DIP point to another using existing macOS/Windows event primitives.

- [ ] **Step 3: Run targeted tests**

Run:

```bash
node --import ./test/register-test.mjs --test test/computerUse.test.js
```

Expected: low-level validation tests pass.

### Task 3: Aggregate Tool

**Files:**
- Modify: `src/main/tools/computerUseTools.js`
- Modify: `test/computerUse.test.js`

- [ ] **Step 1: Add `computer_action` schema**

Add a function tool with an `action` enum for screenshot, move, click, double_click, drag, type, key, scroll, and wait.

- [ ] **Step 2: Route each action**

Route actions to `captureScreenshot`, `moveTo`, `clickAt`, `dragTo`, `typeText`, `pressKey`, `scroll`, and `waitForComputer`.

- [ ] **Step 3: Reuse confirmation**

Use the existing confirmation helper so auth behavior stays consistent.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
node --import ./test/register-test.mjs --test test/computerUse.test.js
```

Expected: aggregate tool tests pass.

### Task 4: Prompt And Slash Command Polish

**Files:**
- Modify: `src/main/computerUse.js`
- Modify: `src/shared/chatCommands.js`
- Modify: `test/chatCommands.test.js`

- [ ] **Step 1: Update system prompt section**

Prefer `computer_action` and describe the screenshot-observe-act-verify loop.

- [ ] **Step 2: Update `/computer` prompt**

Mention `computer_action`, available actions, and verification screenshots.

- [ ] **Step 3: Run chat command tests**

Run:

```bash
node --import ./test/register-test.mjs --test test/chatCommands.test.js
```

Expected: chat command tests pass.

### Task 5: Final Verification And Commit

**Files:**
- All modified source and test files.

- [ ] **Step 1: Run targeted suite**

Run:

```bash
node --import ./test/register-test.mjs --test test/computerUse.test.js test/chatCommands.test.js
```

Expected: all tests pass.

- [ ] **Step 2: Review git diff**

Run:

```bash
git diff -- src/main/computerUse.js src/main/tools/computerUseTools.js src/shared/chatCommands.js test/computerUse.test.js test/chatCommands.test.js
```

Expected: diff only contains computer-use runtime changes.

- [ ] **Step 3: Commit implementation**

Run:

```bash
git add src/main/computerUse.js src/main/tools/computerUseTools.js src/shared/chatCommands.js test/computerUse.test.js test/chatCommands.test.js docs/superpowers/plans/2026-06-15-computer-use-runtime.md
git commit -m "feat: add computer use action runtime"
```
