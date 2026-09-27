# Issue #21 — stable internal links

## Format decision and behavior

Keep diagram format version 2. Add optional `projectLink` to diagram objects with
`{ projectId, boardId, bookmarkId? }`, separate from external URL fields. Existing
v2 readers already retain unknown object properties; current readers validate the
new typed property in both TypeScript and native validation. Older readers retain
but cannot activate it. No URI scheme, path lookup or external fetch is involved.

Use the existing selection controls to add/change/open/remove an object's project
link with a native board/bookmark picker. Read bookmark choices from accepted open
owners or validated unopened files. Resolve only against the active project's
identity and member IDs; missing/foreign/standalone targets stay visibly unresolved
with a change-target action. Reuse session/draft guards and bookmark navigation.
Keep a bounded in-memory back list of originating board/camera/selection contexts;
clear it when the project session changes. Do not restore old document content.

Copies, duplicates, imports and clipboard transfers retain the reference exactly.
A self-link on a duplicate still targets the original board. Foreign-project links
stay unresolved until explicitly repaired. Whole-folder copies keep stable IDs and
resolve inside the opened copy, never by remembering the source path. JSON exports
preserve references; image exports carry no interactive navigation. Standalone
boards display unresolved project links and never auto-open another project.

Validate schema compatibility/security, native parity/roundtrip, stable IDs across
rename/reorder/move, copies/imports/clipboard, absent bookmarks/members/project,
draft navigation guards and back context. Run a native link-to-bookmark/back
journey and desktop/compact finish review, then correctness and ponytail review,
commit and proceed to full local/hosted epic gates.

## Validation and review

The implementation reuses accepted owner snapshots, native member reads, the
existing draft/session guard, named-view transactions and FormDialog. A local
32-entry return stack restores camera and visible selection without replacing
content. Native and TypeScript validation share 316 conformance cases, including
malformed, unknown-key, prototype-key and UTF-16 boundary references.

All 516 editor tests across 64 suites and 33 native tests passed. Tests cover
unsaved bookmark choices, draft blocking, rename/reorder, exact copy/import and
clipboard policy, moved folders, foreign/missing targets, repair/removal and URL
protection. The native overview-to-bookmark journey checks camera, selection,
one canvas, keyboard focus return, copied-folder isolation and standalone state.
It exposed a real focus race on Back: workspace inert state must be committed
before focus returns. The shared navigation completion now flushes that state.

The native capture helper waits for finite running animations without serializing
Web Animation objects. Camera assertions capture the origin after viewport
resizing, and filesystem comparisons use canonical paths. These are harness
corrections; product navigation still uses stable identities, never test paths.

Fresh Impeccable review requested two compact-layout fixes: separate Open boards
from Select visible and give the textual Open link button its natural width.
The native journey includes a non-overlap check for the compact destination.
The documenter confirmed that the incumbent design system remains unchanged.

Correctness review traced serialization, every reference reader, source/target
drafts, identity resolution, missing-bookmark rechecks, disposal and Back stack
lifetime. Ponytail review: **Lean already. Ship.** No URI protocol, duplicated
storage owner, external lookup, new dependency or durable history is necessary.
Final visual re-review and full epic gates are recorded below when complete.

Final release-mode captures:
`/var/folders/sp/nwpxh_hj7yj2bv625j6kjrlc0000gn/T/depthplan-tauri-smoke-Hi9KJy`.
All nine captures were valid; the fresh reviewer marked both fixes resolved and
returned `ship`. The full local gate passed before the final two CSS corrections;
the release native journey passed after them, and the required pre-push gate
revalidates the final committed candidate.

The final eight-workload editor capacity run
`out/capacity/tauri-39gSEU/report.json` passed every correctness and budget check,
including all crash cycles, full-resolution exports and the dense editing soak.
Pan p95 ranged from 38 to 167 ms (200 ms budget), host peak stayed under 190 MiB
(350 MiB budget) and combined WebKit peak under 1,445 MiB (1,536 MiB budget).
The 100-board project run `out/project-capacity/run-7jE2iO/report.json` also passed:
three launches, 180 switches, max cold 1,041 ms, max open 222 ms, switch p95 39 ms,
host 124 MiB and WebKit 330 MiB; search/cancel budgets passed without extra canvases.
These are instrumented macOS results, not installed-platform release certification.
