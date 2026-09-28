# Issue 40: built-in template catalog

## Plan

Expand the current three starters to 28 original editable examples, grouped into
seven gallery categories. Reuse ordinary objects, connectors, authored depth
layouts, the gallery and its existing insertion and personal-library paths.
Retain existing bundled IDs. Add a short visible extension note to every sample.

Update `src/shared/bundledTemplates.ts`, gallery filters, shared catalog/gallery
tests, `scripts/native-templates.mjs` and `docs/templates.md`. Keep data authoring
helpers small; no template engine, dependencies or new document format.

Validate every payload and independent insertion, edit/duplicate/save and
Undo/Redo behavior. Extend the existing native probe to inspect all previews and
insertions and exercise representative flat, nested, matrix and connector-heavy
samples. Run `npm run check:local` on macOS; the PR's Test matrix supplies Windows
and Linux native and installed-package evidence, plus CodeQL.

Main risks are unreadable text, crossing connections and gallery render cost as
the catalog grows. Review actual native screenshots and measure gallery load and
payload size. Rollback is a revert of the catalog changes; inserted content stays
ordinary document content and personal files are unchanged.

## Ponytail review

Applied all findings to the catalog and gallery diff:

- `bundledTemplates.ts:L71`: shrink: repeated parent walks and depth recomputation. Reuse `indexHierarchy` and set the active depth once.
- `bundledTemplates.ts:L8`: delete: unused fallback instruction text. Every entry supplies specific guidance.
- `TemplateLibrary.tsx:L158`: shrink: redundant category list and duplicate search text. Match the manifest tags directly.

- `bundledTemplates.ts:serviceBlueprint`: shrink: rewrite of an already-authored cell. Put the final handoff text directly in the matrix data.

Final review: Lean already. Ship.

No new dependencies, template engines, specialized editors or document formats.

## Validation and visual review

The catalog contains all 28 requested types, four in each category. Shared tests
cover schema validation, stable IDs, aliases and filtering, outer-frame bounds,
empty/populated and repeated insertion, movement, duplication, selection export,
JSON roundtrip, authored layouts and one-step Undo/Redo. Existing Rust tests read
and validate every generated bundled payload and exercise portable-library I/O.

The macOS native gallery probe passes for all 28 previews and inserted examples.
It captures collapsed states for nested samples and exercises actual personal
save and board save/reopen for flowchart, service architecture, RACI and sequence.
Preview and inserted screenshots were inspected for every entry. Review fixes
include a compact two-column Purdue arrangement, exposed rack label, separated
queue, routed reporting connector, shorter industrial connector label, visible
impact/effort axes and frames sized to contain the content and guidance. No
preview titles were clipped in the native font measurement. Responsive gallery
captures cover 1440, 768 and 390 pixel windows.

Repeat with `npm run build:automation` then `node scripts/native-templates.mjs`.
The probe prints its isolated evidence directory, with `bundled-*-preview.png`,
`bundled-*-inserted.png`, `bundled-*-collapsed.png`, `catalog-labels.json` and
`catalog-timing.json`. Screenshots and machine-specific files stay outside Git.
The repository's Test workflow runs this same native helper on all three OSes.

Initial performance measurement on macOS arm64, Node 25.9.0, the 28-entry catalog:
38 gallery opens, including WebDriver overhead, recorded in `catalog-timing.json`.
First open: 621 ms; warm median: 200 ms; warm range: 163–323 ms. Generated catalog
is approximately 208 KB; the lazy gallery chunk is approximately 46 KB / 16 KB
gzip. This records an initial measurement, not a cross-machine latency budget.

Pre-submission gate: `npm run check:local` (host checks, unit/native tests, Clippy,
full native smoke, ordinary release build, license generation and dependency
audits). Normal PR-created gates: Test checks/native/release on macOS, Windows
and Linux, plus CodeQL. Cross-platform evidence comes from those exact-head jobs,
not from the local macOS run.
