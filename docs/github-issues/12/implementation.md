# Issue 12: portable project storage

## Plan

Implement manifest v1 separately from diagram v2, native project/board operations,
and a typed renderer bridge. Reuse document validation, SHA-256 fingerprints,
the existing temporary-file dependency, and standard-library file locks.
Project UI, tab/session management, personal preferences, and autosave scheduling
remain follow-up work. No personal state is written to the manifest.

New board bytes become durable before manifest membership changes. A failed
manifest update retains the previous mapping and reports unlisted files for
explicit recovery. Never adopt or delete unlisted files automatically. Native
dialog selection grants access; subsequent calls use opaque session IDs.

Validate malformed manifests, identity/order/home behavior, imports and copies,
conflicts, interrupted operations, missing/corrupt members, containment, collisions,
relocation, and writer-lock recovery. Run native and renderer tests plus formatting,
lint, types, build, and Clippy. Rollback is a code revert; independent board files
remain ordinary diagram v2 documents.

## Storage contract and recovery

- `projectVersion: 1` is independent of diagram `formatVersion: 2`. The shared
  Zod schema generates the native JSON Schema during `generate:contracts`.
  Both boundaries reject unknown versions/fields, invalid identities, duplicate
  membership/paths, reserved filenames, and invalid home references. Supported
  extension JSON round-trips under `extensions`.
- Bounds: 1 MiB manifest, 1,000 boards, 128 ASCII identity characters, 120 UTF-16
  units per name, 4,000 per description, and 240 characters per relative path.
  Board paths use portable ASCII filenames; Unicode display names and selected
  parent locations are supported. Existing nested directories are supported;
  operations do not create arbitrary directory trees. Case-only renames fail
  without touching the original.
- Renderer entry points live at `window.desktop.projects`: create, open, inspect,
  apply, readBoard, and close. `apply` saves settings, order, and board operations
  using the session's last manifest fingerprint. Native dialogs select roots and
  import sources; renderer-supplied absolute paths cannot grant access.
- Create makes a new folder, manifest, and first home board, with autosave enabled.
  Create/import/duplicate assign fresh document identities while preserving
  document-local references. Duplicate accepts the latest applied snapshot.
  Remove changes membership only and clears the removed home reference.
- A complete, synced board is published without clobbering before the atomic
  manifest replacement. Immediately before commit, fingerprints are checked for
  the manifest and any source/destination boards. Rename switches the manifest
  first, then checks both files again before deleting the old source. Failure
  before commit preserves the old mapping; failure after commit reports that
  reconciliation/cleanup is needed. A reopened project reports unlisted boards
  throughout the root for explicit import/recovery, never adoption or deletion.
- Board paths cannot traverse symlinks, including links whose target remains
  inside the root. Native-selected root aliases resolve to the canonical root.
  Directory/lock identity checks detect replacement while a session is open.
- A persistent `.depthproject.lock` uses an exclusive standard-library OS lock.
  Closing or killing its owner releases the lock; no PID/age heuristic or lock-file
  deletion is needed. Canonical aliases contend for the same lock; folder copies
  have independent ownership. Existing standalone/MCP atomic writes also respect
  project ownership. Locks are advisory: unrelated applications can edit files,
  so fingerprints provide explicit conflict handling, not filesystem-wide CAS.
- `workspaceKey` combines project identity and canonical folder location. Personal
  workspace contents are outside this issue and never enter the shared manifest.

## Review

Applied all Ponytail findings: initialize projects with their validated manifest
instead of temporary placeholder state, and inline the single-use renderer board
validation wrapper, and remove redundant directory creation in the schema generator.
Those simplifications removed 11 lines. The final complexity
review found no further cuts: **Lean already. Ship.** No dependencies were added.

Correctness review additionally guarded rename cleanup, rechecked newly published
board contents before membership commit, aligned native UTF-16 text bounds with
Zod, and included nested unlisted files in recovery diagnostics.

## Validation

Validated on macOS:

- `npm test -- --runInBand`: 59 suites, 475 tests passed. The focused project
  contract/IPC suite was rerun after the simplification.
- `npm run test:native`: 26 native tests passed, including lifecycle, independent
  imports/copies, extensions, all create/import/rename failure phases, external
  edits, read-only/unavailable destinations, symlinks, missing/corrupt/identity-
  mismatched members, relocation/copies, nested orphan output, and a killed owner.
- Formatting, ESLint, TypeScript, the renderer/automation build, and Clippy passed.
  The existing Vite large-chunk warning remains.
- Full native smoke passed using an isolated copy of the automation binaries and
  `TAURI_WEBDRIVER_PORT=4479`. The new project probe exercises native dialogs/IPC,
  create/import/duplicate/rename/reorder/settings/removal, source preservation,
  lock enforcement through standalone Save, close/reopen, and external conflicts.
  Earlier smoke attempts hit macOS sandbox restrictions and a shared automation
  process/build; isolation resolved them. Evidence:
  `/var/folders/sp/nwpxh_hj7yj2bv625j6kjrlc0000gn/T/depthplan-tauri-smoke-veR1Ma`.

Windows/Linux execution and power-loss durability on those filesystems require
checks on their respective hosts; macOS results do not certify them. The project
widget, multi-board editor sessions, autosave scheduling, and native project file
associations remain separate follow-up work.
