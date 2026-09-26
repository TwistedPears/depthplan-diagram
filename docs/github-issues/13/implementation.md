# Issue #13 — independent board sessions

## Plan

Implement the next unblocked core issue in project epic #9. Prerequisite #11 is
closed; main was updated to `95019c2` before starting. This is a feature, using
the standard fix-github-issue workflow with end-to-end implementation and
publication authorized by the user.

- Retain a document owner, file operations and recovery scheduler per open board.
  A registry tracks open boards and the active session independently of persistent
  document identity. Read boards only when explicitly opened.
- Keep inactive UI drafts in React Activity while unmounting inactive Konva stages.
  Pause inactive listeners, preserve rich-editor state and explicit form semantics,
  and route completion callbacks to their original owner.
- Guard close/replacement, retain the standalone flow, and expose session operations
  for #14's navigation UI. No project sidebar, autosave policy or new MCP API here.
- Exercise multiple sessions, delayed I/O, drafts, history, clipboard, export and
  listener cleanup; run the repository's full `npm run check:local` gate. Measure
  repeated switching with a multi-board working set and one active drawing surface.

The primary risks are draft loss during effect cleanup, callbacks observing a new
owner, and background canvases/listeners. Regression tests cover these boundaries.
Rollback is reverting the feature commit; no document or project format changes.

## Validation

- Jest regression coverage exercises independent history/camera/selection, same
  persistent document ID in different sessions, delayed save/read/export,
  stale clipboard completion and cross-board paste, retained form/inline/text undo,
  failed/deduplicated lazy loading, guarded close and listener cleanup.
- Existing standalone App, file-session, transition, recovery and MCP tests remain
  part of the full suite. No document schema, native file access or MCP tools changed.
- Native authoring waits for React to paint after MCP command acknowledgments,
  matching the existing click/bookmark helpers. This fixes a premature selection
  toolbar assertion; the expected controls and values remain unchanged.
- Mandatory local gate: `npm run check:local` (format, types, lint, JS and Rust
  tests, Clippy, native smoke, instrumented and ordinary builds, license checks,
  automation exclusion and dependency audits). Results accompany the PR.
- Submission-created gates: Test on macOS, Windows and Linux, and CodeQL.
  Local evidence covers macOS; the multi-board drawing fixture below uses Chromium.

## Ponytail review

`useDocumentSessions.tsx:L89-94: delete: duplicate focus capture in show(). The existing focusin listener already records the originating editor.`

Applied the six-line deletion and reran the focus/draft regression. No new
runtime dependency, persistence layer, eviction policy or generic session framework.

## Repeatable working-set measurement

Run `npm run dev:renderer -- --host 127.0.0.1`, open
`http://127.0.0.1:1420/fixtures/sessions.html`, and select **Run 60 switches**.
The fixture is excluded from the ordinary index.html build. It uses real React,
ProseMirror and Konva with stubbed native I/O, so it makes no disk changes.

On this macOS host in Chromium 154, three generated boards of 340 objects each
(plus the blank standalone session), 60 switches measured median **65.1 ms**,
p95 **201.7 ms**, maximum **210.6 ms**. Every completed switch retained exactly
**one Konva stage**, **three canvas elements** and **four session controllers**.
Accepted content and revisions stayed unchanged. Reported JS heap went from
74,861,270 to 61,945,800 bytes; GC timing makes these observational samples, not a
heap budget. The fixed stage/canvas counts are the repeatable resource assertion.
This is an initial switching baseline, not a cross-platform or many-board limit.

The fixture caught deferred inactive-stage disposal; the owner now unmounts its
stage before hiding the Activity boundary. Inactive boards retain drafts and
history but have no drawing surface or UI subscriptions.

## Navigation integration for #14

Use `DocumentSessions` with `Workspace`, and consume `useDocumentSessions()`:
`open(boardKey, read)` validates and deduplicates on-demand reads; `activate(key)`
returns false during gestures or destructive transitions; `close(key)` guards
only that session and never modifies project membership or files. `activeKey`
identifies the tab, while each registered owner has a distinct live `sessionId`.
Use `[data-session-navigation]` on tab/drawer controls so focus movement does not
accept inline text or arrow-label drafts. Programmatic callers must use the same
registry rather than replacing the active owner.

Save, history, exports and delayed completions stay bound to their owner. Window
close resolves every session before retiring recovery data. Cancel keeps all
sessions. Reopening a closed board creates fresh history. The standalone startup
session retains New/Open/Reload/Restore behavior; project navigation, settings,
autosave scheduling, aggregate close UI and explicit MCP session routing remain
in their existing follow-up issues (#14–#18).
