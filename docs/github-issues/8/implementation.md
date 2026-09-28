# Issue #8 — template gallery revision

Base: `04f44d7` on `feature/reusable-templates` (draft PR #39).

## Current direction

Templates accelerate drawing on the current board. The user's Miro screenshots
supply the gallery structure: categories, search, preview cards and insertion.
DepthPlan's existing FormDialog, typography, palette and controls supply the style.
This supersedes the initial new-board/component-library workflow.

Insert creates a plain copy of the complete example, starting near the current
view and moving right to clear visible objects and connections with a 48-unit gap.
The selected sample is fitted into view. Its shapes, internal wiring, hierarchy,
folds and depth layouts remain editable with ordinary board tools. Board identity,
file association, project membership, existing geometry and bookmarks are retained.
One Undo restores the board and camera. No template manifest, source library or
bookmarks are added to the board.

The gallery has all/personal views, use-case filters, search, larger previews and
responsive three/two/one-column layouts. Built-in examples start expanded. Personal
save/import/export remain available. Saving a selection uses ordinary Copy,
including multiple roots and standalone connectors; replacing an entry is explicit.
File validation, sharing review, duplicate-import protection and stale-write checks
remain in place. Existing template files stay compatible.

## Complexity review

Ponytail-review suggestions applied:

- Replace dedicated subtree extraction with existing `copySelection` / `readSelection`.
- Delete the unused bundled component catalog and its generator.
- `src/shared/bundledTemplates.ts:L90: delete: unused bookmark generation. Nothing replaces it.`
- `src/shared/recursiveDuplication.ts:L133: delete: unused returned ID map. Return only the edit and selection.`

The final two findings removed 29 lines plus the unused return field. Final complexity pass: **Lean already. Ship.** New-board
transitions, retained-source/version-conflict logic, destination roles, and special
template-editing mode were removed as part of the requested behavior change. No
new dependency, template runtime or placement framework was added.

## Validation

Focused engine/renderer/clipboard checks passed (20 tests). Native gallery testing
passed: category filtering, preview, insertion into the same saved board, repeated
non-overlapping samples, Undo/Redo, personal capture/replacement, portable sharing,
duplicate import, removal and reopening the board. Screenshots were inspected at
1440×900, 768×1024 and 390×844, including the larger preview and selected insertion.

The first native run exposed a test-order assumption: Undo clears the selection.
The save-selection journey now runs before Undo/Redo, consistent with normal editor
behavior. The corrected native journey passes.

`DEVELOPER_DIR=/Library/Developer/CommandLineTools npm run check:local` passed:
formatting, lint, TypeScript, 66 JavaScript suites / 555 tests, 40 Rust tests,
hook/driver tests, Clippy, full native smoke (including the gallery), release build,
license checks and dependency audits. Cargo audit has six existing allowed
unmaintained-package warnings and exited successfully. The final log is
`/tmp/depthplan-gallery-check-local.log`.

Windows/Linux execution is not covered by this macOS run. This revision is a local
commit; GitHub Actions are outside the requested scope.
