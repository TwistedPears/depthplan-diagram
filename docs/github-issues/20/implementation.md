# Issue #20 — project content search

Extend the existing project menu with an explicit Search Project dialog. Reuse the
canonical document search iterator (#5), including object names/rich text/code,
connection labels and bookmarks. Scan members sequentially in manifest order,
read accepted owner snapshots for open boards and native validated files for
unopened boards; retain only bounded result metadata, never mount search canvases.

Cap a search at 500 hits, yield between boards, and stop/ignore pending reads when
canceled or the dialog closes. Report scanned counts, truncation, cancellation and
unreadable boards. Result activation checks the captured project session/manifest,
owner revision or source fingerprint, then uses existing reveal/bookmark semantics.
A changed result asks for a new search rather than guessing by name. Explicit
reveal may create an ordinary Undo step; searching never edits content.

Use the incumbent FormDialog, labels, native buttons and result groups. No new
runtime dependency, persistent index, worker pool or project-wide MCP API. Validate
hidden/unopened, open-dirty, stale/duplicate/missing, nonmatches, cancellation,
keyboard navigation, one canvas, representative 100-board timing and native
search-to-target before correctness/ponytail review and commit.

## Implementation and evidence

The UI shares #5's pure search iterator, so matching, ordering, snippets and typed
entities do not diverge. Accepted owner snapshots are authoritative for open
boards; each unopened source uses the existing native reader. Result activation
checks the captured project/session/revision or fingerprint before calling the
owner's existing reveal/bookmark operations. The canvas reuses its current
free-workspace focus calculation. Searching adds no history; reveal is undoable.

510 tests across 63 suites passed, followed by the added 500-result-ceiling
regression (18 project navigation tests total). Format, type and lint checks
passed. Coverage includes dirty versus unopened, hidden rich text/code,
connections/bookmarks, duplicate names, stale revisions/fingerprints, missing
boards, nonmatches, cancellation, focus and no extra canvases. A native journey
confirmed an unopened hidden Handler in the correct same-named board, exact
selection, one-step Undo, unchanged source bytes and focus return to its tab.

The embedded driver's keyboard actions dispatch synthetic events without native
button defaults. The initial Enter probe therefore did not activate the semantic
button; the retained journey exercises focus plus button activation. This is
WebView evidence, not physical keyboard or assistive-technology certification.
Native testing also exposed a real modal focus bug: focus was attempted before
React unmounted the dialog. Closing synchronously before focusing the target tab
fixed it; the final journey asserts the native active element.

The fixed release-mode 100-board scenario passed three launches in
`out/project-capacity/run-1Yob5i/report.json`: search 245–340 ms, largest frame gap
27 ms, cancel 13–14 ms, cold max 1,864 ms, open max 223 ms, switch p95 40 ms,
host 124 MiB and attributed WebKit 370 MiB. Each search finds 100 results while
retaining five explicitly opened owners and one canvas; source hashes stay intact.
Budgets remain 5,000 ms search, 250 ms frame/cancel and prior startup/memory limits.

Correctness review traced every reader and activation check, cancellation after a
pending read, result cap, draft navigation guard and shared reveal transaction.
Ponytail review: **Lean already. Ship.** The existing iterator, native read,
FormDialog and canvas focus path cover the scope without an index, background
service, worker pool or new dependency. The documenter found no durable system
change. Fresh finish review and final capture paths are recorded below.

Final settled native captures and passing journey:
`/var/folders/sp/nwpxh_hj7yj2bv625j6kjrlc0000gn/T/depthplan-tauri-smoke-ViNWfT`.
Fresh Impeccable finish review inspected all three widths and returned `ship`,
with no material fixes. Initial capture timing caught a disabled-state transition;
the retained probe waits enabled results and finite animations before capturing.
