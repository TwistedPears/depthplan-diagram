# Issue #14 — project navigation and board management

## Scope

Connect the approved project drawer and tabs to the existing native storage and
session registry. Implement New/Open/Close Project, explicit standalone opening,
create/import-copy/rename/duplicate/reorder/remove, and manual project-board saves.
Retain source files on removal, preserve identity/history on rename, retain drafts
on switching, and guard all sessions before a workspace replacement.

Native board writes use the existing project's held writer lock with manifest,
membership, document identity, path containment and source fingerprint checks.
Multi-file import reports individual failures and retains each successful copy.
Save Copy preserves the project's source association and unsaved revision.

## Direction contract

THESIS: A canvas-first board collection, distinct from the objects inside a board.
OWN-WORLD: Inherit DepthPlan's cool white floating controls, slate labels, blue
interaction states and system typography from DESIGN.md.
STORY: Create or open a project, find a member, and keep open work in independent
tabs; closing a tab, removing membership and closing a project are distinct.
FIRST VIEWPORT: Existing identity card at top left; 280px collapsible drawer below;
open tabs beneath the drawing tools; Save/Export stay at top right. Compact widths
show the active tab with an Open boards control and an overlay drawer.
FORM: Local extension of the approved #11 surface; no concept seed or new visual
identity. Native form dialogs protect creation and destructive decisions.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish
review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Validation

- Interaction tests cover lazy loading, duplicate labels, keyboard focus, history,
  guarded removal, canceled workspace transitions, Save Copy, missing-home fallback,
  Unicode names, filename collisions, and closing the final tab.
- Native storage tests cover owned saves, stale fingerprints, manifest conflicts,
  mismatched identities and valid/invalid legacy import.
- The native UI journey in `scripts/native-project-navigation.mjs` exercises real
  creation, multi-file import, rename, duplicate, reorder, remove and reopen, with
  screenshots at 1440×1000, 1024×728 and 900×640. It runs from native smoke.
- Jest: 61 suites / 488 tests passed. After the keyboard fixes, the two affected
  suites passed all 12 tests; typecheck and lint passed.
- Native Rust: 27 tests passed. Automation build and full native smoke passed.
  The final isolated project journey passed again after simplification and keyboard
  fixes; verified captures are in the local `depthplan-tauri-smoke-aQJ1fI` evidence
  directory. Hosted cross-platform CI remains the epic's final gate.
- Fresh Impeccable finish review scored both keyboard findings resolved: Find
  retains native Home/End behavior, and compact tab traversal excludes hidden tabs.
  Disposition: **ship**, scoped to those fixes; all three recaptures are valid.
- The documenter compared the finished extension with PRODUCT.md, DESIGN.md and
  incumbent controls and preserved the system. It recorded the absent design
  sidecar and the drawer's borderless shadow as drift, without canonizing either.

## Simplification review

- Native import filename generation now reads occupied paths once rather than
  repeatedly scanning the directory for each candidate.
- Session close reuses the registry's existing drop operation; project reload
  returns its native promise without an unnecessary inner await.
- No new dependencies or parallel document authority. Lean already. Ship.

Autosave, settings, recents/restoration and explicit multi-session MCP targeting
remain the subsequent issues in the epic; this issue does not claim those shipped.
