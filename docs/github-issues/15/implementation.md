# Issue #15 — portable project settings

Project Settings edits the existing manifest's name, description, home board and
autosave policy through explicit Apply/Cancel. The native manifest transaction
validates membership and fingerprints before publishing; failed changes retain
the form values and show the error. Names do not rename project folders. Reveal
accepts only a live native project handle and verifies the owned location.

The home board opens when available; otherwise project order supplies the first
readable member. Removing the home board clears its setting. Board content,
history and styles are independent; local workspace restoration is issue #17.
Source autosave consumes the policy in issue #16.

Direction: inherit the existing FormDialog, white/slate/blue controls and native
inputs. Keep a scrollable field area and visible Apply/Cancel at all three
specified viewports. No new visual system, CSS or runtime dependencies.

Validation: six project interaction tests, 28 native tests, typecheck and lint
pass. Tests cover cancel, invalid names/home identity, failed persistence,
external conflict, unchanged board snapshots/history and bytes, settings after
folder relocation, and selected-home reopen. The native project journey passes
with settings captures at 1440×1000, 1024×728 and 900×640 in the local
`depthplan-tauri-smoke-3wa8sY` evidence directory, including a real external
manifest conflict with the entire alert visible at 900px. The settings dialog is part of
the existing native smoke journey for later hosted cross-platform CI.

Ponytail review: reused manifest actions, FormDialog and existing CSS. No
abstractions or dependencies to remove. Lean already. Ship.

The fresh finish reviewer scored both findings resolved: failure messages scroll
into view and the help explains that autosave does not retain backups/version
history. Disposition: **ship**, scoped to those fixes. The documenter confirmed
the incumbent system remains applicable and preserved DESIGN.md.
