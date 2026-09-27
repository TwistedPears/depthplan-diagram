# Issue #17 — local project workspace and opening

Bounded user-local recent entries and workspace snapshots use native project
identity plus canonical location. Tabs/order, active board, camera, drawer and
window size stay in the profile's `workspaces.json`; source documents and project
manifests remain unchanged. Writes are serialized and debounced, with a flush
before a guarded replacement or quit. Empty saved workspaces stay empty; removed
and unreadable tabs are skipped and home/project order supplies the fallback.
Corrupt local state is ignored. Undo history is not persisted.

Chooser, recent and cold/warm OS requests reuse guarded project opening in the
same window. The native open queue survives an empty project and board switches,
and waits for startup recovery discovery and the user's restore/skip decision.
Same canonical opens keep live sessions; another process still cannot acquire a
held project writer. A copied location gets independent local state. Locate
migrates a moved recent's workspace only when identity matches, its old location
is unavailable, and the native confirmation is accepted. Remove from Recents
affects only the local entry.

The startup surface remains the existing canvas, with New/Open/Recent Project
menu actions, as #11 explicitly specifies. Recent Projects reuses FormDialog and
shows full locations plus local-state and fresh-undo wording. No new CSS or
runtime dependencies. The finish review removed an unnecessary startup panel,
then verified the corrected six captures and returned **ship** for that fix.
The documenter preserved DESIGN.md and reported no new visual system drift.

`.depthproject` has a separate exported macOS type and Linux MIME definition,
project artwork, and Windows association. The NSIS icon hook uses the class and
install scope registered by [Tauri's native association helper](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/windows/nsis/FileAssociation.nsh).
`npm run icons` regenerates the project/app icon assets. Actual installed-OS
association evidence across macOS/Windows/Linux remains #19's integrated gate;
command-line and injected OS event tests are not presented as installation proof.

Validation: typecheck, lint, strict Clippy, 502 Jest tests and 31 native tests pass. Earlier native navigation/settings and persistence/crash journeys also pass after restoration was added. Native
three-board restoration verifies tabs, active board and cameras, cold/warm opens,
same-location focus, copied isolation, explicit moved-location recovery, missing
members, and byte-identical healthy source files. Corrected startup-menu and
Recent Projects captures at 1440×1000, 1024×728 and 900×640 are in
`depthplan-tauri-smoke-w95PZh`. The journey runs in the cross-platform native smoke
suite. Recovery-before-open, intentionally empty state and home fallback have
focused regression checks.

Ponytail review: deleted the unsolicited startup panel and its CSS, reused the
existing canvas/menu and FormDialog, and removed unnecessary optional API paths.
Lean already. Ship.
