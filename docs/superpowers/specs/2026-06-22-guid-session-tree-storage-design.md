# GUID Session Tree Storage Design

## Goal

Store sidebar navigation roots and their descendants under `~/.CRAgent/sessions` using GUID directory IDs, so the "会话" tree and the "项目" tree have distinct top-level storage roots and every child node preserves its visual hierarchy on disk.

## Current State

Plain sessions are stored directly under `~/.CRAgent/sessions/<sessionId>`.
Project-bound sessions are stored under `~/.CRAgent/Projects/<projectId>/sessions/<sessionId>`.
Runtime code generally asks `SessionStore.locateSessionStorage(sessionId)` for the base session directory, so plan files, images, tool results, and redirected `.cragent` writes already follow the returned storage root.

## Target Layout

Create two persistent top-level GUID roots under `~/.CRAgent/sessions`:

```text
~/.CRAgent/sessions/
  <sessionsRootGuid>/
    <sessionId>/
      meta.json
      messages.ndjson
      ...
  <projectsRootGuid>/
    <projectId>/
      <sessionId>/
        meta.json
        messages.ndjson
        ...
```

The `sessionsRootGuid` represents the sidebar "会话" root. The `projectsRootGuid` represents the sidebar "项目" root. These GUID values are generated once and stored in a local layout metadata file so they remain stable across app restarts.

## Behavior

- Opening or creating a plain session writes to `~/.CRAgent/sessions/<sessionsRootGuid>/<sessionId>`.
- Adding a project creates `~/.CRAgent/sessions/<projectsRootGuid>/<projectId>`.
- Creating a session under a project writes to `~/.CRAgent/sessions/<projectsRootGuid>/<projectId>/<sessionId>`.
- Removing a project deletes only `~/.CRAgent/sessions/<projectsRootGuid>/<projectId>` and removes the project from `projects.json`.
- Session-produced files such as `plan.md`, redirected `.cragent` files, images, and tool result artifacts remain inside the located session directory.

## Migration

Startup migration must be idempotent:

- Move existing plain split sessions from `~/.CRAgent/sessions/<sessionId>` into `<sessionsRootGuid>/<sessionId>`.
- Move existing project sessions from `~/.CRAgent/Projects/<projectId>/sessions/<sessionId>` into `<projectsRootGuid>/<projectId>/<sessionId>`.
- Move any legacy project sessions still found directly under `~/.CRAgent/sessions/<sessionId>` into the matching project directory when their meta contains a known `projectId`.
- Preserve legacy `.json` session files by moving them into the same target base directory and letting existing split-session migration convert them when opened.
- Leave unknown or malformed files untouched.

## Components

- `src/shared/sessionTreeStoragePaths.js`: new small helper module for layout metadata, root path derivation, and child path derivation.
- `src/main/sessionStore.js`: use the new helpers for resolving plain and project session roots, locating sessions, ensuring project layout, and migrating old layouts.
- `src/shared/projectStoragePaths.js`: stop treating `~/.CRAgent/Projects` as the active project-session location while keeping compatibility helpers for legacy migration if needed.
- Tests in `test/sessionStoreProjects.test.js` and a new focused path-helper test file.

## Error Handling

If layout metadata is missing, invalid, or incomplete, regenerate only missing GUIDs and persist the repaired metadata. If a target migration directory already exists, use the existing `moveSessionStorage` behavior so the target session directory is replaced consistently with current project-session migration semantics.

## Testing

Add tests that verify:

- Plain sessions are created under the "会话" GUID root.
- Projects and project sessions are created under the "项目" GUID root with project and session hierarchy preserved.
- Legacy `Projects/<projectId>/sessions/<sessionId>` sessions migrate into the new `sessions/<projectsRootGuid>/<projectId>/<sessionId>` layout.
- Existing direct plain sessions migrate into `sessions/<sessionsRootGuid>/<sessionId>`.
- Session storage path redirection continues to place generated files under the located session directory.
