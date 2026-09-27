# Project inline controls — validation

Date: 2026-09-27. Scope: the eleven requested project UI refinements.

| Requirement                  | Implementation and check                                                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project side button          | Labeled Project; native navigation verifies it reappears after closing the drawer.                                                                                                      |
| Hide side button             | Not rendered while the drawer or a project dialog is open; renderer and native checks.                                                                                                  |
| Right-pointing close icon    | Uses arrow-down-to-line at −90°; native checks icon and rotation.                                                                                                                       |
| Inline project name          | Untitled Project default; Enter/blur commits, Escape cancels, keyboard focus returns after Enter/Escape. Renderer and native checks.                                                    |
| First Save                   | Only the native dialog; snake_case suggested project filename, cancellation retains memory, all boards published beside the manifest. Native disk checks include a closed edited board. |
| Inline board names           | Double-click/F2 or context-menu Rename opens the shared inline input. Native title editing; renderer cancellation/commit checks.                                                        |
| Recent Projects submenu      | Native details submenu limited to five; renderer and native selection checks, including moved-project location and restored workspace.                                                  |
| Notifications                | Manual messages are plain text near the bottom; native position/border checks. An observer detects no autosave progress/success notifications.                                          |
| Unsaved marker and filenames | Superscript star and Unsaved tooltip; exact filename editing with extension, Enter/blur/Escape. Native project and standalone disk renames; Rust collision/stale-source checks.         |
| Save Project command         | Renderer and native menus renamed; existing multi-board save behavior retained.                                                                                                         |
| Remove Project Settings      | Dialog, component, menu item and event removed. Inline project-title changes preserve older manifest metadata.                                                                          |

The native snapshots were inspected at 1440×1000 and 900×640; automated layout captures also cover 1024×728. Filename changes keep the existing portable path and collision restrictions, including rejection of case-only renames.

Ponytail review applied: removed the unused toolbar status prop, obsolete loading state, stale status/toggle CSS, duplicate CSS declarations, and repeated error formatting. The shared inline editor replaces the name dialogs; recent projects uses native HTML details. No dependency added.

The final full-diff Ponytail pass removed 29 more lines: unused project-forget/reveal IPC commands and renderer bindings, the reveal-only location accessor, and its stale UI mock. Internal recent-location migration still uses the existing workspace-forget operation.

Checks completed: 525 renderer tests, 36 Rust tests, five driver checks, eight Git-hook checks, TypeScript, ESLint, Prettier, Rust format, Clippy with warnings denied for application code, automation build, npm audit (zero vulnerabilities), and Cargo audit. Cargo audit reports six existing allowed unmaintained-dependency advisories. Existing vendored macOS warnings and the renderer chunk-size warning remain.

Before the final dead-code cleanup, full native smoke passed, including conflict recovery, recent-project reopening, all authoring/export regressions and normal quit. Native evidence: `/var/folders/sp/nwpxh_hj7yj2bv625j6kjrlc0000gn/T/depthplan-tauri-smoke-7KbY5T`.

The ordinary production build also passed before that cleanup (`npm run build`), including license checks. The normal dependency tree excludes WebDriver. These checks ran on macOS; Windows and Linux were not exercised in this task.

After the final cleanup, all 525 renderer tests and 36 Rust tests passed again, along with TypeScript, ESLint, Prettier, Rust format, Clippy and the staged whitespace check. No active runtime path changed in this cleanup.
