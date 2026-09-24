# Issue 10: native DepthPlan document files

## Scope and approach

- Keep document schema v2 and JSON serialization unchanged.
- Ordinary Save uses the recorded source filename, including legacy
  `.depthplan.json`. Save As passes the source identity only to suggest the same
  basename with `.depthplan`; cancellation preserves the current source.
- New documents and editable exports default to `.depthplan`. Explicitly selected
  filenames remain the user's choice. Open accepts native and legacy files and
  validates their contents.
- Register `.depthplan` as an application-specific type and reuse the app artwork
  for its document icon. Do not associate generic `.json` files with the app.
- Feed OS/launch-selected files through opaque native request IDs and the existing
  draft/unsaved-work transition guards. Handle startup requests, file URLs, live
  requests, serialized opens and delayed duplicate startup notifications.
- macOS uses its native open event. Windows/Linux release builds use the official
  [Tauri single-instance plugin](https://v2.tauri.app/plugin/single-instance/) to
  forward subsequent launches. Development/automation builds remain isolated.
- Update maintained samples and their references. No project format or project UI
  is introduced by this issue.

## Review

Ponytail review identified a duplicate error-reporting catch in the OS-open hook.
It was removed because the document transition layer already reports failures.
Follow-up review of the final additions found no further simplifications.

## Validation

Regression coverage includes legacy Save versus Save As, canceled migration,
exact source preservation, malformed native files, Unicode paths/file URLs,
unsaved-work cancellation, serialized requests and delayed startup duplicates.
The native smoke suite exercises actual native persistence and renderer opening;
its automated file chooser verifies default suggestions without claiming to test
the real operating-system dialog.

Validated on macOS on 2026-09-24:

- `npm run check:local` passed: formatting, lint, type checking, eight hook checks,
  52 JavaScript suites / 414 tests, 15 Rust tests, Clippy, the full native smoke
  suite, release build, license checks and dependency audits.
- `npm audit` reported zero vulnerabilities. Cargo audit passed with seven
  existing allowed warnings: six unmaintained dependencies and the existing
  `glib::VariantStrIter` advisory. The renderer retains its existing bundle-size
  warning.
- `npm run package:dir` passed. The built macOS bundle contains the exported
  document UTI, `.depthplan` association and its referenced document icon.
- Finder recognized `.depthplan` as a DepthPlan document. Double-clicking a
  disposable document opened it both with the packaged app running and after
  quitting the app. Save As confirmed the expected source basename in each case.
- The real Open dialog accepted a disposable `legacy.depthplan.json`. Ordinary
  Save reported that same filename. Save As suggested `legacy.depthplan` and
  created the copy. The legacy file's SHA-256 stayed unchanged across Save As;
  both documents matched except for their modification timestamps. Canceling
  Save As also worked in the packaged app.

Windows/Linux installed associations and second-instance forwarding require
their respective hosts and remain unverified. AppImage desktop/MIME integration
also depends on the user's installation method. These checks do not establish
cross-platform release readiness.

Rollback restores the previous filename defaults/associations. The unchanged JSON
payload can still be read after renaming a native document to `.depthplan.json`.
