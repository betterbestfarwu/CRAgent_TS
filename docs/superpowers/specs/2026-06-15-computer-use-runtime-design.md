# Computer Use Runtime Design

## Goal

Upgrade the existing computer-use feature from a set of separate desktop tools into a first-class action interface closer to Claude/OpenAI computer-use workflows.

## Current Context

The project already includes desktop display mapping, screenshots, mouse movement, clicking, typing, key chords, scrolling, a Settings toggle, `/computer` command handling, and tests. The missing piece is a unified action surface and the action set expected by built-in computer-use loops.

## Selected Approach

Implement a lightweight compatibility layer:

- Keep existing `computer_*` tools for compatibility.
- Add one aggregate `computer_action` tool that routes structured actions to the same low-level functions.
- Add missing `drag` and `wait` actions.
- Improve the computer-use prompt so the agent follows a screenshot-observe-act-verify loop.
- Continue using existing confirmation and auth behavior.

## Tool Contract

`computer_action` accepts:

- `action: "screenshot"` with optional `display`
- `action: "move"` with `x`, `y`
- `action: "click"` with `x`, `y`, optional `button`
- `action: "double_click"` with `x`, `y`
- `action: "drag"` with `x`, `y`, `to_x`, `to_y`, optional `duration_ms`
- `action: "type"` with `text`, optional `clear_first`
- `action: "key"` with `key`
- `action: "scroll"` with optional `direction`, `amount`, `x`, `y`
- `action: "wait"` with optional `ms`

All coordinate values use the existing global DIP coordinate system from `computer_displays`.

## Safety And Permissions

Computer-use actions continue to use `shouldRequireToolConfirmation` through the existing auth mode. Screenshot, mouse, keyboard, drag, scroll, and wait are all routed through the same confirmation helper. `fullAccess` can skip inline confirmations as it does today.

## Prompt Behavior

When computer use is enabled, the system prompt should present `computer_action` as the preferred high-level interface while documenting the old tools as available compatibility helpers. `/computer` should instruct the model to:

1. Inspect display layout and screenshot.
2. Reason from the screenshot before clicking or typing.
3. Execute one focused action or a small batch when safe.
4. Verify important UI changes with another screenshot.

## Testing

Add unit coverage for:

- `computer_action` registration when computer use is enabled.
- Aggregate action routing for `wait` without OS dependencies.
- `drag` and `wait` low-level validation behavior.
- Updated `/computer` prompt mentions the action loop and aggregate tool.

Targeted test command:

```bash
node --import ./test/register-test.mjs --test test/computerUse.test.js test/chatCommands.test.js
```
