# Issue #8 — reusable templates

Base: `bc2a495` (latest origin/main at implementation start).

## Plan

Implement a versioned template manifest inside a normal document extension,
three bundled starters, independent document/component instantiation, a personal
native app-data library, and a Templates dialog for preview, authoring, import,
export, and insertion. Retain one portable source per template version in created
documents. Reuse document validation, duplication, reparenting, bookmark, history,
dirty-work guards, dialog styling, and native atomic writes.

No hosted catalog, executable content, live inheritance, SQL engine, or 3D renderer.
Component bookmarks stay out of destination documents. External connections are
excluded with a visible report; intentional content links remain reviewable.

Validate engine behavior (hidden descendants, rotated/deep parents, IDs, layouts,
bookmarks, folds, history and rejection), renderer flows, and native library/file
boundaries. Run the repository local checks and native template smoke, then review
for correctness and over-engineering before an explicit-path local commit.
Cross-platform execution can only be claimed for platforms actually exercised.

Rollback: revert the feature commit. Ordinary documents remain formatVersion 2;
template metadata is optional, and no document or library migration is required.

## Delivered

- Shared v1 manifest schema generated for the renderer/native boundaries; ordinary
  documents remain formatVersion 2. Clean portable `.depthtemplate` files and
  app-data personal entries use validated, conflict-checked atomic writes.
- Full hierarchy/depth/fold copying, fresh instance identities, remapped starter
  bookmarks/cameras, independent subtree insertion and retained source definitions.
  Insertion preserves destination disclosure, unrelated geometry and bookmarks.
- Templates dialog: bundled/personal/document sources, name/tag filter, shared
  canvas preview, collapsed/expanded/bookmark views, guidance, authoring, explicit
  update/copy/remove, import/export review, duplicate-copy handling and reveal.
- ERD, isometric 2D infrastructure and ISA-95/Purdue starters with reusable patterns,
  overview/detail bookmarks and extension instructions. See `docs/templates.md`.

## Review and validation

Ponytail-review applied: replaced hand-written manifest shape validation with the
existing Zod → native JSON Schema pattern, and removed an unused duplication
return value. Final complexity review: **Lean already. Ship.** No dependencies
were added. Correctness review also fixed preview clipping, editor naming,
review/back draft preservation, and unrelated Z-order changes during insertion.

`DEVELOPER_DIR=/Library/Developer/CommandLineTools npm run check:local` passed on
macOS on 2026-09-28. This includes formatting, lint, types, hook/driver tests,
**66 JavaScript suites / 555 tests**, **40 native tests**, Clippy, full native smoke,
ordinary release build, license generation, automation exclusion and dependency
audits. Cargo audit reported six existing allowed warnings; its exit status was 0.

The new `scripts/native-templates.mjs` probe is included in native smoke and can
also run independently after `npm run build:automation`. It exercises create,
explicit edit/update, export/import, duplicate import, removal, repeated insertion,
Save/Discard/Cancel, and reopening a saved document to add a retained component.
All three starters were visually inspected collapsed and expanded; the library
was also checked at a 390px window width. Native tests round-trip portable templates
between two independent library directories and reject corrupt/oversize payloads,
stale updates, duplicate writes and path traversal.

Performance baseline: macOS native automation build, three bundled starters and
up to two personal entries plus a retained source; seven library-open-to-next-paint
samples were 19, 32, 22, 16, 26, 28 and 29 ms (median **26 ms**). This measures local
UI response, not end-to-end disk loading or hardware input latency. The native
probe writes repeatable timing and screenshot evidence to its disposable profile.

The initial full native run failed only because the menu expectation lacked the
new Templates entry. The expectation was updated and the complete local check
was rerun successfully. Final local log: `/tmp/depthplan-templates-check-local-final.log`.

Windows and Linux native execution and installed-package acceptance remain
unverified on this host. No push, PR, remote CI dispatch or issue-state change
was requested. The pre-existing `docs/sample/.depthproject.lock` remains excluded.
